// scripts/utils/deposit.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { BN } from "bn.js";
import { loadState, loadUserKeypair } from './setup';

async function depositTokens() {
  console.log('💰 Depositing tokens to position...');
  
  // Get command line arguments or use defaults
  const args = process.argv.slice(2);
  const amountA = args[0] ? parseInt(args[0]) : 10; // Default: 10 Token A
  const amountB = args[1] ? parseInt(args[1]) : 1;    // Default: 1 Token B
  
  console.log('💰 Depositing:', amountA, 'Token A,', amountB, 'Token B');
  
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
  
  // Convert amounts to proper decimals
  const depositAmountA = new BN(amountA * 10**6); // Token A has 6 decimals
  const depositAmountB = new BN(amountB * 10**9); // Token B has 9 decimals
  
  console.log('🔢 Raw amounts:', depositAmountA.toString(), depositAmountB.toString());
  
  // Get initial balances
  const userAccountA = await getAccount(provider.connection, new PublicKey(state.userTokenA));
  const userAccountB = await getAccount(provider.connection, new PublicKey(state.userTokenB));
  
  console.log('\n📊 Before deposit:');
  console.log('User Token A balance:', (Number(userAccountA.amount) / 10**6).toFixed(6));
  console.log('User Token B balance:', (Number(userAccountB.amount) / 10**9).toFixed(9));
  
  // Check if user has enough tokens
  if (userAccountA.amount < depositAmountA.toNumber()) {
    throw new Error(`Insufficient Token A balance. Have: ${Number(userAccountA.amount) / 10**6}, Need: ${amountA}`);
  }
  if (userAccountB.amount < depositAmountB.toNumber()) {
    throw new Error(`Insufficient Token B balance. Have: ${Number(userAccountB.amount) / 10**9}, Need: ${amountB}`);
  }
  
  const tx = await program.methods
    .depositToPosition(depositAmountA, depositAmountB)
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
  const feeAccountA = await getAccount(provider.connection, new PublicKey(state.feeTokenA));
  const feeAccountB = await getAccount(provider.connection, new PublicKey(state.feeTokenB));
  
  // Get position state
  const positionState = await program.account.position.fetch(new PublicKey(state.position));
  
  console.log('\n📊 After deposit:');
  console.log('User Token A balance:', (Number(userAccountAAfter.amount) / 10**6).toFixed(6));
  console.log('User Token B balance:', (Number(userAccountBAfter.amount) / 10**9).toFixed(9));
  
  console.log('\n💼 Position balances:');
  console.log('Token A vault balance:', (positionState.tokenAVaultBalance.toNumber() / 10**6).toFixed(6));
  console.log('Token B vault balance:', (positionState.tokenBVaultBalance.toNumber() / 10**9).toFixed(9));
  
  console.log('\n💰 Fees collected:');
  console.log('Fee Token A:', (Number(feeAccountA.amount) / 10**6).toFixed(6));
  console.log('Fee Token B:', (Number(feeAccountB.amount) / 10**9).toFixed(9));
  
  // Calculate fee percentages
  const feeA = Number(feeAccountA.amount);
  const feeB = Number(feeAccountB.amount);
  const totalDepositedA = positionState.tokenAVaultBalance.toNumber() + feeA;
  const totalDepositedB = positionState.tokenBVaultBalance.toNumber() + feeB;
  
  if (totalDepositedA > 0) {
    const feePercentageA = (feeA / totalDepositedA * 100).toFixed(3);
    console.log('Fee percentage A:', feePercentageA + '%');
  }
  if (totalDepositedB > 0) {
    const feePercentageB = (feeB / totalDepositedB * 100).toFixed(3);
    console.log('Fee percentage B:', feePercentageB + '%');
  }
  
  console.log('\n✅ Deposit successful!');
  console.log('\n🎯 Try these next:');
  console.log('- npx ts-node scripts/utils/check-balances.ts');
  console.log('- npx ts-node scripts/utils/withdraw.ts 25  (withdraw 25%)');
  console.log('- npx ts-node scripts/utils/deposit.ts 500 2  (deposit more)');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  depositTokens().catch(console.error);
}
