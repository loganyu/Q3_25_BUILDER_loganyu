// scripts/utils/withdraw.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';

async function withdrawTokens() {
  console.log('💸 Withdrawing tokens from position...');
  
  // Get command line arguments or use default
  const args = process.argv.slice(2);
  const withdrawPercentage = args[0] ? parseInt(args[0]) : 25; // Default: 25%
  
  if (withdrawPercentage < 1 || withdrawPercentage > 100) {
    throw new Error('Withdraw percentage must be between 1 and 100');
  }
  
  console.log('📊 Withdrawing:', withdrawPercentage + '%');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  // Check if position exists
  if (!state.position) {
    throw new Error('No position found. Run create-position.ts first');
  }
  
  // Get initial balances
  const userAccountABefore = await getAccount(provider.connection, new PublicKey(state.userTokenA));
  const userAccountBBefore = await getAccount(provider.connection, new PublicKey(state.userTokenB));
  const positionStateBefore = await program.account.position.fetch(new PublicKey(state.position));
  
  console.log('\n📊 Before withdrawal:');
  console.log('User Token A balance:', (Number(userAccountABefore.amount) / 10**6).toFixed(6));
  console.log('User Token B balance:', (Number(userAccountBBefore.amount) / 10**9).toFixed(9));
  
  console.log('\n💼 Position balances before:');
  console.log('Token A vault:', (positionStateBefore.tokenAVaultBalance.toNumber() / 10**6).toFixed(6));
  console.log('Token B vault:', (positionStateBefore.tokenBVaultBalance.toNumber() / 10**9).toFixed(9));
  console.log('Token A in LP:', (positionStateBefore.tokenAInLp.toNumber() / 10**6).toFixed(6));
  console.log('Token B in LP:', (positionStateBefore.tokenBInLp.toNumber() / 10**9).toFixed(9));
  console.log('Token A in lending:', (positionStateBefore.tokenAInLending.toNumber() / 10**6).toFixed(6));
  console.log('Token B in lending:', (positionStateBefore.tokenBInLending.toNumber() / 10**9).toFixed(9));
  
  // Calculate total position value
  const totalA = positionStateBefore.tokenAVaultBalance.toNumber() + 
                 positionStateBefore.tokenAInLp.toNumber() + 
                 positionStateBefore.tokenAInLending.toNumber();
  const totalB = positionStateBefore.tokenBVaultBalance.toNumber() + 
                 positionStateBefore.tokenBInLp.toNumber() + 
                 positionStateBefore.tokenBInLending.toNumber();
  
  console.log('\n📊 Total position value:');
  console.log('Total Token A:', (totalA / 10**6).toFixed(6));
  console.log('Total Token B:', (totalB / 10**9).toFixed(9));
  
  if (totalA === 0 && totalB === 0) {
    console.log('⚠️  Position is empty, nothing to withdraw');
    return;
  }
  
  const tx = await program.methods
    .withdrawFromPosition(withdrawPercentage)
    .accountsPartial({
      position: new PublicKey(state.position),
      protocolAuthority: new PublicKey(state.protocolAuthority),
      userTokenA: new PublicKey(state.userTokenA),
      userTokenB: new PublicKey(state.userTokenB),
      positionTokenAVault: new PublicKey(state.positionTokenAVault),
      positionTokenBVault: new PublicKey(state.positionTokenBVault),
      feeTokenA: new PublicKey(state.feeTokenA),
      feeTokenB: new PublicKey(state.feeTokenB),
      owner: user.publicKey,
      tokenAMint: new PublicKey(state.tokenAMint),
      tokenBMint: new PublicKey(state.tokenBMint),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  console.log('\n📝 Transaction signature:', tx);
  console.log('🔗 View on explorer:', getExplorerUrl(tx));

  // Get final balances
  const userAccountAAfter = await getAccount(provider.connection, new PublicKey(state.userTokenA));
  const userAccountBAfter = await getAccount(provider.connection, new PublicKey(state.userTokenB));
  const positionStateAfter = await program.account.position.fetch(new PublicKey(state.position));
  const feeAccountA = await getAccount(provider.connection, new PublicKey(state.feeTokenA));
  const feeAccountB = await getAccount(provider.connection, new PublicKey(state.feeTokenB));
  
  console.log('\n📊 After withdrawal:');
  console.log('User Token A balance:', (Number(userAccountAAfter.amount) / 10**6).toFixed(6));
  console.log('User Token B balance:', (Number(userAccountBAfter.amount) / 10**9).toFixed(9));
  
  console.log('\n💼 Position balances after:');
  console.log('Token A vault:', (positionStateAfter.tokenAVaultBalance.toNumber() / 10**6).toFixed(6));
  console.log('Token B vault:', (positionStateAfter.tokenBVaultBalance.toNumber() / 10**9).toFixed(9));
  console.log('Token A in LP:', (positionStateAfter.tokenAInLp.toNumber() / 10**6).toFixed(6));
  console.log('Token B in LP:', (positionStateAfter.tokenBInLp.toNumber() / 10**9).toFixed(9));
  console.log('Token A in lending:', (positionStateAfter.tokenAInLending.toNumber() / 10**6).toFixed(6));
  console.log('Token B in lending:', (positionStateAfter.tokenBInLending.toNumber() / 10**9).toFixed(9));
  
  // Calculate amounts received
  const receivedA = Number(userAccountAAfter.amount) - Number(userAccountABefore.amount);
  const receivedB = Number(userAccountBAfter.amount) - Number(userAccountBBefore.amount);
  
  console.log('\n💰 Tokens received:');
  console.log('Token A received:', (receivedA / 10**6).toFixed(6));
  console.log('Token B received:', (receivedB / 10**9).toFixed(9));
  
  console.log('\n💰 Total fees collected:');
  console.log('Fee Token A:', (Number(feeAccountA.amount) / 10**6).toFixed(6));
  console.log('Fee Token B:', (Number(feeAccountB.amount) / 10**9).toFixed(9));
  
  // Show percentage remaining
  const remainingA = positionStateAfter.tokenAVaultBalance.toNumber() + 
                    positionStateAfter.tokenAInLp.toNumber() + 
                    positionStateAfter.tokenAInLending.toNumber();
  const remainingB = positionStateAfter.tokenBVaultBalance.toNumber() + 
                    positionStateAfter.tokenBInLp.toNumber() + 
                    positionStateAfter.tokenBInLending.toNumber();
  
  console.log('\n📊 Position remaining:');
  console.log('Total Token A remaining:', (remainingA / 10**6).toFixed(6));
  console.log('Total Token B remaining:', (remainingB / 10**9).toFixed(9));
  
  if (remainingA === 0 && remainingB === 0) {
    console.log('🎉 Position is now empty! You can close it with:');
    console.log('npx ts-node scripts/utils/close-position.ts');
  }
  
  console.log('\n✅ Withdrawal successful!');
  console.log('\n🎯 Try these next:');
  console.log('- npx ts-node scripts/utils/check-balances.ts');
  console.log('- npx ts-node scripts/utils/withdraw.ts 100  (withdraw remaining)');
  console.log('- npx ts-node scripts/utils/deposit.ts 100 1  (deposit more)');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  withdrawTokens().catch(console.error);
}
