import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BergMarketplace } from "../target/types/berg_marketplace";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  PublicKey,
  Connection,
} from "@solana/web3.js";


describe("berg-marketplace", () => {
  const provider = anchor.AnchorProvider.env();
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.bergMarketplace as Program<BergMarketplace>;

  const connection = provider.connection;
  const umi = createUmi(connection);
  const payer = provider.wallet;

  let seller;
  let buyer;
  let treasury;
  let listing;
  let listing_token_account;
  let seller_token_account;
  let buyer_token_account;

  let nftMint = generateSigner(umi);
  seller = Keypair.generate();
  buyer = Keypair.generate();

  const [marketplace] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), marketplace.toBuffer(), seller.]
  )




  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
