import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { assert } from "chai";


describe("vault", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.vault as Program<Vault>;
  const connection = provider.connection;
  const user = provider.publicKey;

  const vaultStatePda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("state"), provider.publicKey.toBytes()], program.programId
  )[0]
  const vaultPda = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultStatePda.toBytes()], program.programId
  )[0]

  it("Is initialized!", async () => {
    const tx = await program.methods.initialize()
    .accountsPartial({
      user,
      vaultStatePda,
      vaultPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("Your transaction signature", tx);

    const vaultBal = await connection.getBalance(vaultPda);
    const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
    assert.isAtLeast(vaultBal, rentExempt, "vault must be funded with rent-exempt minimum");
  });

  it("Deposit lamports", async () => {
    const amount = new anchor.BN(1_000_000);
    const before = await connection.getBalance(vaultPda);

    await program.methods
      .deposit(amount)
      .accountsPartial({
        signer: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const after = await connection.getBalance(vaultPda);
    assert.equal(after, before + amount.toNumber(), "vault balance should increase by deposit amount");
  });

  it("Withdraw lamports", async () => {
    const amount = new anchor.BN(500_000);
    const beforeVault = await connection.getBalance(vaultPda);
    const beforeUser = await connection.getBalance(user);

    await program.methods
      .withdraw(amount)
      .accountsPartial({
        signer: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const afterVault = await connection.getBalance(vaultPda);
    const afterUser = await connection.getBalance(user);

    assert.equal(afterVault, beforeVault - amount.toNumber(), "vault balance should decrease by withdraw amount");
    assert.isAtLeast(afterUser, beforeUser + amount.toNumber() - 5_000, "user balance should increase by roughly the withdrawn amount");
  });

    it("Close vault_state and drain remaining lamports", async () => {
      const remaining = await connection.getBalance(vaultPda);
      const beforeUser = await connection.getBalance(user);

      await program.methods
        .close()
        .accountsPartial({
          signer: user,
          vaultState: vaultStatePda,
          vault: vaultPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const postVaultBal = await connection.getBalance(vaultPda);
      assert.equal(postVaultBal, 0, "vault PDA must be drained");

      const vaultStateAccount = await connection.getAccountInfo(vaultStatePda);
      assert.isNull(vaultStateAccount, "vault_state account should be closed");

      const afterUser = await connection.getBalance(user);
      assert.isAtLeast(afterUser, beforeUser + remaining - 5_000, "user should receive the leftover vault balance");
    });


});
