// tests/capital_reallocator.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../target/types/capital_reallocator";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair, Transaction } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  createMint, 
  createAccount, 
  mintTo, 
  getAccount,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";

// Mock program IDs for external protocols
const MOCK_METEORA_PROGRAM = new PublicKey("METoYfK9KhJHnec5HL8kTybWGmTEJvnqwNYWuWtFGHH");
const MOCK_KAMINO_PROGRAM = new PublicKey("KAMiNoXmYHN3hiPvvufVqwRPEPAy6Jh8H7F7SEKcfGH");  
const MOCK_JUPITER_PROGRAM = new PublicKey("JUPyTerVGraWPqKUN5g8STQTQbZvCEPfbZFpRFGHHHH");

// Mock Pyth receiver program ID (for testing)
const MOCK_PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

describe("capital_reallocator", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  // Test accounts
  let protocolAuthority: PublicKey;
  let feeRecipient: PublicKey;
  let userMainAccount: PublicKey;
  let position: PublicKey;
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let userTokenA: PublicKey;
  let userTokenB: PublicKey;
  let feeTokenA: PublicKey;
  let feeTokenB: PublicKey;
  let positionTokenAVault: PublicKey;
  let positionTokenBVault: PublicKey;
  let keeperAuthority: PublicKey;
  let mockPriceUpdate: PublicKey;
  
  const user = Keypair.generate();
  const positionId = new BN(1);
  const lpRangeMin = new BN(100 * 10**6); // $100
  const lpRangeMax = new BN(200 * 10**6); // $200
  const feeBps = 50; // 0.5%

  // Helper to create a mock price update account
  async function createMockPriceUpdate(): Promise<PublicKey> {
    const mockAccount = Keypair.generate();
    
    // Create a mock account that pretends to be a PriceUpdateV2
    // The program will validate ownership, so this will fail in actual tests
    // But it's fine for testing the account structure
    const space = 3312; // Approximate size of PriceUpdateV2
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(space);
    
    const createAccountTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mockAccount.publicKey,
        lamports,
        space,
        programId: MOCK_PYTH_RECEIVER, // Mock program ID
      })
    );
    
    await provider.sendAndConfirm(createAccountTx, [mockAccount]);
    
    return mockAccount.publicKey;
  }

  before(async () => {
    // Setup user with SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL)
    );

    // Create mints
    tokenAMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6 // USDC decimals
    );

    tokenBMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      9 // SOL decimals
    );

    // Create user token accounts
    userTokenA = await createAccount(
      provider.connection,
      user,
      tokenAMint,
      user.publicKey
    );

    userTokenB = await createAccount(
      provider.connection,
      user,
      tokenBMint,
      user.publicKey
    );

    // Mint tokens
    await mintTo(
      provider.connection,
      user,
      tokenAMint,
      userTokenA,
      user,
      1000 * 10**6 // 1000 USDC
    );

    await mintTo(
      provider.connection,
      user,
      tokenBMint,
      userTokenB,
      user,
      10 * 10**9 // 10 SOL
    );

    // Derive PDAs
    [protocolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("protocol")],
      program.programId
    );

    [userMainAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), user.publicKey.toBuffer()],
      program.programId
    );

    [position] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        user.publicKey.toBuffer(),
        positionId.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    positionTokenAVault = await getAssociatedTokenAddress(
      tokenAMint,
      position,
      true
    );

    positionTokenBVault = await getAssociatedTokenAddress(
      tokenBMint,
      position,
      true
    );

    [keeperAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("keeper")],
      program.programId
    );

    // Setup fee recipient
    feeRecipient = Keypair.generate().publicKey;

    feeTokenA = await createAccount(
      provider.connection,
      user,
      tokenAMint,
      feeRecipient
    );

    feeTokenB = await createAccount(
      provider.connection,
      user,
      tokenBMint,
      feeRecipient
    );

    // Create mock price update account
    mockPriceUpdate = await createMockPriceUpdate();
  });

  describe("Core Functionality", () => {
    it("Initializes the protocol", async () => {
      const tx = await program.methods
        .initializeProtocol(feeBps)
        .accountsPartial({
          protocolAuthority,
          feeRecipient,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const protocolState = await program.account.protocolAuthority.fetch(protocolAuthority);
      assert.equal(protocolState.protocolFeeBps, feeBps);
    });

    it("Initializes user account", async () => {
      await program.methods
        .initializeUser()
        .accountsPartial({
          userMainAccount,
          owner: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const userState = await program.account.userMainAccount.fetch(userMainAccount);
      assert.equal(userState.owner.toString(), user.publicKey.toString());
    });

    it("Creates a position", async () => {
      await program.methods
        .createPosition(positionId, lpRangeMin, lpRangeMax)
        .accountsPartial({
          position,
          userMainAccount,
          protocolAuthority,
          tokenAMint,
          tokenBMint,
          positionTokenAVault,
          positionTokenBVault,
          owner: user.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const positionState = await program.account.position.fetch(position);
      assert.equal(positionState.owner.toString(), user.publicKey.toString());
      assert.equal(positionState.lastRebalanceSlot.toString(), "0");
      assert.equal(positionState.lastRebalancePrice.toString(), "0");
      assert.equal(positionState.totalRebalances.toString(), "0");
    });

    it("Deposits tokens", async () => {
      const depositAmountA = new BN(100 * 10**6);
      const depositAmountB = new BN(1 * 10**9);

      await program.methods
        .depositToPosition(depositAmountA, depositAmountB)
        .accountsPartial({
          position,
          protocolAuthority,
          userTokenA,
          userTokenB,
          positionTokenAVault,
          positionTokenBVault,
          feeTokenA,
          feeTokenB,
          owner: user.publicKey,
          tokenAMint,
          tokenBMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const positionState = await program.account.position.fetch(position);
      assert.ok(positionState.tokenAVaultBalance.toNumber() > 0);
      assert.ok(positionState.tokenBVaultBalance.toNumber() > 0);
    });

    it("Pauses and resumes position", async () => {
      // Pause
      await program.methods
        .pausePosition()
        .accountsPartial({
          position,
          owner: user.publicKey,
        })
        .signers([user])
        .rpc();

      let positionState = await program.account.position.fetch(position);
      assert.equal(positionState.pauseFlag, true);

      // Resume
      await program.methods
        .resumePosition()
        .accountsPartial({
          position,
          owner: user.publicKey,
        })
        .signers([user])
        .rpc();

      positionState = await program.account.position.fetch(position);
      assert.equal(positionState.pauseFlag, false);
    });

    it("Withdraws from position", async () => {
      const withdrawPercentage = 25;

      await program.methods
        .withdrawFromPosition(withdrawPercentage)
        .accountsPartial({
          position,
          protocolAuthority,
          userTokenA,
          userTokenB,
          positionTokenAVault,
          positionTokenBVault,
          feeTokenA,
          feeTokenB,
          owner: user.publicKey,
          tokenAMint,
          tokenBMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const positionState = await program.account.position.fetch(position);
      // Should have ~75% of original balance
      assert.ok(positionState.tokenAVaultBalance.toNumber() > 0);
    });
  });

  describe("Mock Price Integration (Will fail validation)", () => {
    it("Attempts check status with mock price (expected to fail)", async () => {
      try {
        await program.methods
          .checkPositionStatus()
          .accountsPartial({
            position,
            priceUpdate: mockPriceUpdate,
          })
          .rpc();
        
        assert.fail("Should have failed with mock price");
      } catch (error: any) {
        // Expected to fail because mock account isn't owned by Pyth
        console.log("✓ Mock price correctly rejected");
        assert.ok(error.toString().includes("AccountOwnedByWrongProgram") || 
                  error.toString().includes("price_update"));
      }
    });

    it("Attempts rebalance with mock price (expected to fail)", async () => {
      try {
        await program.methods
          .rebalancePosition()
          .accountsPartial({
            position,
            priceUpdate: mockPriceUpdate,
            meteoraProgram: MOCK_METEORA_PROGRAM,
            kaminoProgram: MOCK_KAMINO_PROGRAM,
            jupiterProgram: MOCK_JUPITER_PROGRAM,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        assert.fail("Should have failed with mock price");
      } catch (error: any) {
        // Expected to fail
        console.log("✓ Mock rebalance correctly rejected");
        assert.ok(error.toString().includes("AccountOwnedByWrongProgram") || 
                  error.toString().includes("price_update"));
      }
    });
  });
});

console.log("\n📝 Note: Price-related tests will fail as expected.");
console.log("Use 'yarn pyth-devnet' scripts for real Pyth testing on devnet.\n");
