import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  PublicKey,
  Connection,
} from "@solana/web3.js";
import { randomBytes, sign } from "node:crypto";
import {
  Account,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "bn.js";

describe("anchor-escrow", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorEscrow as Program<AnchorEscrow>;

  const connection = provider.connection;

  let maker: Keypair;
  let taker: Keypair;
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let takerAtaA: Account;
  let takerAtaB: Account;
  let makerAtaA: Account;
  let makerAtaB: Account;
  let escrow: anchor.web3.PublicKey;
  let vault: anchor.web3.PublicKey;
  let bump:number;

  const seed = new BN(randomBytes(8));

  const airdrop = async (
    connection: anchor.web3.Connection,
    publicKey: PublicKey
  ) => {
    const signature = await connection.requestAirdrop(
      publicKey,
      2 * LAMPORTS_PER_SOL
    );
  
    console.log(`Airdrop signature:${signature}`);
  
    const confirm_airdrop = await connection.confirmTransaction(
      signature,
      "confirmed"
    );
  
    const balance = await connection.getBalance(publicKey);
  
    console.log(`tx signature ${JSON.stringify(confirm_airdrop,null,2)}`);
    console.log(balance);
    return confirm_airdrop;
  };

  before(async () => {
    maker = anchor.web3.Keypair.generate();
    taker = anchor.web3.Keypair.generate();

    await airdrop(connection, maker.publicKey);
    await airdrop(connection, taker.publicKey);

    mintA = await createMint(connection, maker, maker.publicKey, null, 6);

    console.log(`Mint A address:${mintA}`);

    mintB = await createMint(connection, taker, taker.publicKey, null, 6);

    console.log(`Mint B address:${mintB}`);

    makerAtaA = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintA,
      maker.publicKey
    );

    console.log(`Maker_ATA_A address:${makerAtaA.address}`);

    takerAtaA = await getOrCreateAssociatedTokenAccount(
      connection,
      taker,
      mintA,
      taker.publicKey
    );

    console.log(`Taker_ATA_A address:${takerAtaA.address}`);

    makerAtaB = await getOrCreateAssociatedTokenAccount(
      connection,
      maker,
      mintB,
      maker.publicKey
    );

    console.log(`Maker_ATA_B address:${makerAtaB.address}`);

    takerAtaB = await getOrCreateAssociatedTokenAccount(
      connection,
      taker,
      mintB,
      taker.publicKey
    );

    console.log(`Taker_ATA_B address:${takerAtaB.address}`);

    let mintToMakerAtaA = await mintTo(
      connection,
      maker,
      mintA,
      makerAtaA.address,
      maker,
      100000 * 10 ** 6
    );
    console.log(`Minted to makerAtaA:${mintToMakerAtaA}`);

    let mintToTakerAtaB = await mintTo(
      connection,
      taker,
      mintB,
      takerAtaB.address,
      taker,
      100000 * 10 ** 6
    );
    console.log(`Minted to makerAtaA:${mintToTakerAtaB}`);

    [escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    console.log(`Escrow account created at:${escrow}`);

    vault = getAssociatedTokenAddressSync(mintA, escrow, true);

    console.log(`Vault address:${vault}`);
  });



  it("initializes escrow", async () => {
    const tx = await program.methods
      .make(seed, new BN(1_000_000), new BN(1_000_000_000))
      .accountsPartial({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA: makerAtaA.address,
        escrow,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:SystemProgram.programId
      })
      .signers([maker])
      .rpc();

    console.log(`Escrow initialization Tx signature:${tx}`);
  });

  it("takes the deal for taker", async () => {
    const tx = await program.methods
      .take(new BN(1_000_000_000))
      .accountsPartial({
        maker: maker.publicKey,
        taker: taker.publicKey,
        escrow,
        mintA,
        mintB,
        vault,
        makerAtaB: makerAtaB.address,
        takerAtaB: takerAtaB.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    console.log(`Taker takes the deal signature:${tx}`);
  });

  it("Makes escrow again", async () => {
    const tx = await program.methods
      .make(seed, new BN(1_000_000), new BN(1_000_000)).accountsPartial({
        maker:maker.publicKey,
        mintA,
        mintB,
        escrow,
        vault,
        makerAtaA:makerAtaA.address,
        tokenProgram:TOKEN_PROGRAM_ID,
        associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:SystemProgram.programId
      })
      .signers([maker])
      .rpc();

      console.log(TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID);

    console.log(`Escrow reinitialization:${tx}`);
  });

  it("Refunds makerAtaA" , async() => {
    const tx = await program.methods.refund().accountsPartial({
      maker:maker.publicKey,
      mintA,
      makerAtaA:makerAtaA.address,
      escrow,
      vault,
      tokenProgram:TOKEN_PROGRAM_ID,
      associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID
    }).signers([maker]).rpc()
  });
});
