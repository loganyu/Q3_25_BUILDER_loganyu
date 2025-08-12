// scripts/utils/fund-devnet.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';
import { writeFileSync, readFileSync } from 'fs';

async function fundDevnetAccounts() {
  console.log('💰 Setting up devnet token accounts...');
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  if (!provider.connection.rpcEndpoint.includes('devnet')) {
    throw new Error('This script is only for devnet! Current RPC: ' + provider.connection.rpcEndpoint);
  }
  
  const user = loadUserKeypair();
  const state = loadState();
  
  console.log('👤 User:', user.publicKey.toString());
  
  // Check SOL balance
  const balance = await provider.connection.getBalance(user.publicKey);
  console.log('💰 SOL balance:', (balance / 1e9).toFixed(4));
  
  if (balance < 0.1 * 1e9) {
    console.log('⚠️  Low SOL! Get more from https://faucet.solana.com/');
    console.log('   Your address:', user.publicKey.toString());
    return;
  }
  
  // Use Circle's devnet USDC (the one from their faucet)
  const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  const solMint = new PublicKey('So11111111111111111111111111111111111111112');
  
  console.log('🪙 USDC Mint:', usdcMint.toString());
  console.log('🪙 SOL Mint:', solMint.toString());
  
  // Get associated token addresses
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, user.publicKey);
  const userSolAccount = await getAssociatedTokenAddress(solMint, user.publicKey);
  
  console.log('💼 User USDC account:', userUsdcAccount.toString());
  console.log('💼 User SOL account:', userSolAccount.toString());
  
  // Check if accounts exist and create if needed
  const accountsToCreate = [];
  
  try {
    await getAccount(provider.connection, userUsdcAccount);
    console.log('✅ USDC account already exists');
  } catch {
    console.log('🏗️ USDC account needs to be created');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userUsdcAccount,
        user.publicKey,
        usdcMint
      )
    );
  }
  
  try {
    await getAccount(provider.connection, userSolAccount);
    console.log('✅ Wrapped SOL account already exists');
  } catch {
    console.log('🏗️ Wrapped SOL account needs to be created');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userSolAccount,
        user.publicKey,
        solMint
      )
    );
  }
  
  // Create accounts if needed
  if (accountsToCreate.length > 0) {
    const tx = new anchor.web3.Transaction().add(...accountsToCreate);
    const signature = await provider.connection.sendTransaction(tx, [user]);
    await provider.connection.confirmTransaction(signature);
    console.log('✅ Created token accounts');
    console.log('📝 Transaction:', signature);
  }
  
  // Check balances
  try {
    const usdcBalance = await getAccount(provider.connection, userUsdcAccount);
    console.log('💰 USDC balance:', (Number(usdcBalance.amount) / 1e6).toFixed(6));
  } catch {
    console.log('💰 USDC balance: 0 (account created but no tokens)');
  }
  
  try {
    const solBalance = await getAccount(provider.connection, userSolAccount);
    console.log('💰 Wrapped SOL balance:', (Number(solBalance.amount) / 1e9).toFixed(9));
  } catch {
    console.log('💰 Wrapped SOL balance: 0');
  }
  
  // Update state.json with correct devnet addresses
  const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
  currentState.tokenAMint = usdcMint.toString();
  currentState.tokenBMint = solMint.toString();
  currentState.userTokenA = userUsdcAccount.toString();
  currentState.userTokenB = userSolAccount.toString();
  
  writeFileSync('./scripts/state.json', JSON.stringify(currentState, null, 2));
  console.log('💾 Updated state.json with devnet accounts');
  
  console.log('\n🎯 Next steps:');
  console.log('1. Get USDC from: https://faucet.circle.com/');
  console.log('   Your address:', user.publicKey.toString());
  console.log('2. Wrap some SOL: spl-token wrap 0.1');
  console.log('3. Then try: yarn deposit 10 0.001');
  
  console.log('\n✅ Devnet accounts ready!');
}

if (require.main === module) {
  fundDevnetAccounts().catch(console.error);
}

export { fundDevnetAccounts };
