// scripts/utils/fund-devnet.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
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
  
  // Use the mints from state.json (set by setup.ts)
  const usdcMint = new PublicKey(state.tokenAMint);
  const solMint = new PublicKey(state.tokenBMint);
  
  console.log('🪙 USDC Mint:', usdcMint.toString());
  console.log('🪙 SOL Mint:', solMint.toString());
  
  // Detect which token program each mint uses by checking the account owner
  let usdcTokenProgram = TOKEN_PROGRAM_ID;
  let solTokenProgram = TOKEN_PROGRAM_ID;
  
  // Check USDC mint account owner
  const usdcMintInfo = await provider.connection.getAccountInfo(usdcMint);
  if (!usdcMintInfo) {
    console.error('❌ USDC mint not found on devnet:', usdcMint.toString());
    console.log('   This might be the wrong address. Common devnet USDC addresses:');
    console.log('   - 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (devnet USDC)');
    console.log('   - Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr (devnet USDC-Dev)');
    throw new Error('USDC mint not found');
  }
  
  if (usdcMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    usdcTokenProgram = TOKEN_2022_PROGRAM_ID;
    console.log('📦 USDC uses Token-2022 program');
  } else if (usdcMintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    usdcTokenProgram = TOKEN_PROGRAM_ID;
    console.log('📦 USDC uses standard Token program');
  } else {
    console.error('❌ USDC mint has unexpected owner:', usdcMintInfo.owner.toString());
    throw new Error('Invalid USDC mint owner');
  }
  
  // Check SOL mint account owner (wrapped SOL always uses standard token program)
  const solMintInfo = await provider.connection.getAccountInfo(solMint);
  if (!solMintInfo) {
    throw new Error('Wrapped SOL mint not found');
  }
  
  if (solMintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    solTokenProgram = TOKEN_PROGRAM_ID;
    console.log('📦 Wrapped SOL uses standard Token program');
  } else {
    console.error('❌ SOL mint has unexpected owner:', solMintInfo.owner.toString());
    throw new Error('Invalid SOL mint owner');
  }
  
  // Get associated token addresses with the correct program
  const userUsdcAccount = await getAssociatedTokenAddress(
    usdcMint, 
    user.publicKey,
    false,
    usdcTokenProgram
  );
  
  const userSolAccount = await getAssociatedTokenAddress(
    solMint, 
    user.publicKey,
    false,
    solTokenProgram
  );
  
  console.log('💼 User USDC account:', userUsdcAccount.toString());
  console.log('💼 User SOL account:', userSolAccount.toString());
  
  // Check if accounts exist and create if needed
  const accountsToCreate = [];
  
  try {
    await getAccount(provider.connection, userUsdcAccount, undefined, usdcTokenProgram);
    console.log('✅ USDC account already exists');
    
    // Get and display balance
    const account = await getAccount(provider.connection, userUsdcAccount, undefined, usdcTokenProgram);
    console.log('💰 USDC balance:', (Number(account.amount) / 1e6).toFixed(6));
  } catch {
    console.log('🏗️ USDC account needs to be created');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userUsdcAccount,
        user.publicKey,
        usdcMint,
        usdcTokenProgram
      )
    );
  }
  
  try {
    await getAccount(provider.connection, userSolAccount, undefined, solTokenProgram);
    console.log('✅ Wrapped SOL account already exists');
    
    // Get and display balance
    const account = await getAccount(provider.connection, userSolAccount, undefined, solTokenProgram);
    console.log('💰 Wrapped SOL balance:', (Number(account.amount) / 1e9).toFixed(9));
  } catch {
    console.log('🏗️ Wrapped SOL account needs to be created');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userSolAccount,
        user.publicKey,
        solMint,
        solTokenProgram
      )
    );
  }
  
  // Create accounts if needed
  if (accountsToCreate.length > 0) {
    const tx = new anchor.web3.Transaction().add(...accountsToCreate);
    
    try {
      const signature = await provider.connection.sendTransaction(tx, [user]);
      await provider.connection.confirmTransaction(signature);
      console.log('✅ Created token accounts');
      console.log('📝 Transaction:', signature);
    } catch (e) {
      console.error('❌ Failed to create token accounts:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
      throw e;
    }
  }
  
  // Update state.json with correct account addresses (keep existing mints)
  const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
  currentState.userTokenA = userUsdcAccount.toString();
  currentState.userTokenB = userSolAccount.toString();
  
  // Store the token programs for future reference
  currentState.tokenAProgramId = usdcTokenProgram.toString();
  currentState.tokenBProgramId = solTokenProgram.toString();
  
  writeFileSync('./scripts/state.json', JSON.stringify(currentState, null, 2));
  console.log('💾 Updated state.json with devnet accounts');
  
  console.log('\n🎯 Next steps:');
  console.log('1. Get devnet SOL from: https://faucet.solana.com/');
  console.log('   Your address:', user.publicKey.toString());
  
  // Check which USDC faucet to recommend based on the mint
  if (usdcMint.toString() === '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') {
    console.log('2. Get devnet USDC from Solana Labs faucet or airdrop');
    console.log('   Try: spl-token mint', usdcMint.toString(), '1000');
  } else if (usdcMint.toString() === 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr') {
    console.log('2. Get USDC-Dev from Solana faucet');
  } else {
    console.log('2. Get USDC for mint:', usdcMint.toString());
  }
  
  console.log('3. Wrap some SOL: spl-token wrap 0.1');
  console.log('4. Then run: yarn init-protocol');
  console.log('5. Then try: yarn deposit 10 0.001');
  
  console.log('\n✅ Devnet accounts ready!');
}

if (require.main === module) {
  fundDevnetAccounts().catch(console.error);
}

export { fundDevnetAccounts };
