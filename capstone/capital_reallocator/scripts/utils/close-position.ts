// scripts/utils/close-position.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';

async function closePosition() {
  console.log('🔒 Closing position...');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  // Check if position exists
  if (!state.position) {
    throw new Error('No position found. Create a position first');
  }
  
  // Check if position is empty
  const positionState = await program.account.position.fetch(new PublicKey(state.position));
  
  const totalA = positionState.tokenAVaultBalance.toNumber() + 
                 positionState.tokenAInLp.toNumber() + 
                 positionState.tokenAInLending.toNumber();
  const totalB = positionState.tokenBVaultBalance.toNumber() + 
                 positionState.tokenBInLp.toNumber() + 
                 positionState.tokenBInLending.toNumber();
  
  console.log('📊 Position balances:');
  console.log('Total Token A:', (totalA / 10**6).toFixed(6));
  console.log('Total Token B:', (totalB / 10**9).toFixed(9));
  
  if (totalA > 0 || totalB > 0) {
    console.log('❌ Position is not empty!');
    console.log('💡 Withdraw all tokens first:');
    console.log('   npx ts-node scripts/utils/withdraw.ts 100');
    return;
  }
  
  // Get counts before closing
  const userStateBefore = await program.account.userMainAccount.fetch(
    new PublicKey(state.userMainAccount)
  );
  const protocolStateBefore = await program.account.protocolAuthority.fetch(
    new PublicKey(state.protocolAuthority)
  );
  
  console.log('\n📊 Before closing:');
  console.log('User position count:', userStateBefore.positionCount.toString());
  console.log('Protocol total positions:', protocolStateBefore.totalPositions.toString());
  
  const tx = await program.methods
    .closePosition()
    .accountsPartial({
      position: new PublicKey(state.position),
      userMainAccount: new PublicKey(state.userMainAccount),
      protocolAuthority: new PublicKey(state.protocolAuthority),
      positionTokenAVault: new PublicKey(state.positionTokenAVault),
      positionTokenBVault: new PublicKey(state.positionTokenBVault),
      tokenAMint: new PublicKey(state.tokenAMint),
      tokenBMint: new PublicKey(state.tokenBMint),
      owner: user.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  console.log('\n📝 Transaction signature:', tx);
  console.log('🔗 View on explorer:', getExplorerUrl(tx));

  // Verify position is closed
  try {
    await program.account.position.fetch(new PublicKey(state.position));
    console.log('❌ Error: Position still exists');
  } catch (error: any) {
    if (error.toString().includes('Account does not exist')) {
      console.log('✅ Position account successfully closed');
    } else {
      console.log('❌ Unexpected error:', error.message);
    }
  }

  // Verify counters were updated
  const userStateAfter = await program.account.userMainAccount.fetch(
    new PublicKey(state.userMainAccount)
  );
  const protocolStateAfter = await program.account.protocolAuthority.fetch(
    new PublicKey(state.protocolAuthority)
  );
  
  console.log('\n📊 After closing:');
  console.log('User position count:', userStateAfter.positionCount.toString());
  console.log('Protocol total positions:', protocolStateAfter.totalPositions.toString());
  
  // Verify counts decreased
  const userCountDiff = userStateBefore.positionCount.toNumber() - userStateAfter.positionCount.toNumber();
  const protocolCountDiff = protocolStateBefore.totalPositions.toNumber() - protocolStateAfter.totalPositions.toNumber();
  
  console.log('\n📈 Count changes:');
  console.log('User position count decreased by:', userCountDiff);
  console.log('Protocol total positions decreased by:', protocolCountDiff);
  
  if (userCountDiff === 1 && protocolCountDiff === 1) {
    console.log('✅ Counters updated correctly');
  } else {
    console.log('⚠️  Counter update may have issues');
  }
  
  // Update state file to remove position info
  const updatedState = { ...state };
  delete updatedState.position;
  delete updatedState.positionId;
  delete updatedState.positionTokenAVault;
  delete updatedState.positionTokenBVault;
  
  require('fs').writeFileSync('./scripts/state.json', JSON.stringify(updatedState, null, 2));
  console.log('💾 Updated state file (removed position)');
  
  console.log('\n🎉 Position closed successfully!');
  console.log('\n🎯 You can now:');
  console.log('- npx ts-node scripts/utils/create-position.ts  (create new position)');
  console.log('- npx ts-node scripts/utils/check-balances.ts   (check final state)');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  closePosition().catch(console.error);
}
