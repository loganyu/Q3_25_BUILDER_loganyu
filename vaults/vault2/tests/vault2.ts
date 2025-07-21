import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault2 } from "../target/types/vault2";

describe("vault2", () => {
  const provider = anchor.AnchorProvider.env();
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.vault2 as Program<Vault2>;

  const vaultState = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("state"), provider.publicKey.toBytes()], program.programId)[0];
  const vault = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault"), vaultState.toBytes()], program.programId)[0];

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize()
    .accountsPartial({
      user: provider.publicKey,
      vaultState,
      vault,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("Your transaction signature", tx);
  });
});
