// scripts/utils/init-user.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { SystemProgram } from "@solana/web3.js";
import { loadState, loadUserKeypair } from './setup';

async function initializeUser() {
  console.log('👤 Initializing user account...');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  console.log('👤 User public key:', user.publicKey.toString());
  console.log('📋 User main account PDA:', state.userMainAccount);
  
  const tx = await program.methods
    .initializeUser()
    .accountsPartial({
      userMainAccount: new anchor.web3.PublicKey(state.userMainAccount),
      owner: user.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  console.log('📝 Transaction signature:', tx);
  console.log('🔗 View on explorer:', getExplorerUrl(tx));

  // Verify user state
  const userState = await program.account.userMainAccount.fetch(
    new anchor.web3.PublicKey(state.userMainAccount)
  );
  
  console.log('\n✅ User initialized successfully!');
  console.log('👤 Owner:', userState.owner.toString());
  console.log('📊 Position count:', userState.positionCount.toString());
  console.log('📈 Total positions created:', userState.totalPositionsCreated.toString());
  
  console.log('\n🎯 Next step: npx ts-node scripts/utils/create-position.ts');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  initializeUser().catch(console.error);
}
