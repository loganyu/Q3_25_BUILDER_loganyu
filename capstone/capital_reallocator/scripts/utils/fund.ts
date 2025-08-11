// scripts/utils/fund.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  getAccount,
  createSyncNativeInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';

async function fundDevnetUser() {
  console.log('💰 Funding devnet user...');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const isDevnet = provider.connection.rpcEndpoint.includes('devnet');
  
  if (!isDevnet) {
    console.log('✅ Local environment detected - funding not needed');
    console.log('Tokens should already be minted. Run: yarn balances');
    return;
  }
  
  console.log('🌐 Connected to:', provider.connection.rpcEndpoint);
  console.log('👤 User:', user.publicKey.toString());
  
  // Check SOL balance
  const solBalance = await provider.connection.getBalance(user.publicKey);
  console.log('💰 SOL balance:', (solBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  if (solBalance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('🚨 Insufficient SOL balance!');
    console.log('Please get SOL from: https://faucet.solana.com/');
    console.log('Your address:', user.publicKey.toString());
    return;
  }
  
  // Check and create token accounts if needed
  console.log('\n💼 Checking token accounts...');
  
  const tokenAMint = new PublicKey(state.tokenAMint);
  const tokenBMint = new PublicKey(state.tokenBMint);
  const userTokenA = new PublicKey(state.userTokenA);
  const userTokenB = new PublicKey(state.userTokenB);
  
  // Check USDC account
  try {
    const usdcAccount = await getAccount(provider.connection, userTokenA);
    const usdcBalance = Number(usdcAccount.amount) / 10**6;
    console.log('💵 USDC balance:', usdcBalance.toFixed(6));
    
    if (usdcBalance === 0) {
      console.log('💡 Get USDC from: https://faucet.circle.com/');
      console.log('   Enter your address:', user.publicKey.toString());
      console.log('   Select "Solana Devnet"');
    }
  } catch (error) {
    console.log('💼 Creating USDC account...');
    try {
      const createUSDCTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey, userTokenA, user.publicKey, tokenAMint
        )
      );
      await provider.connection.sendTransaction(createUSDCTx, [user]);
      console.log('✅ Created USDC account:', userTokenA.toString());
      console.log('💡 Get USDC from: https://faucet.circle.com/');
    } catch (error) {
      console.log('❌ Failed to create USDC account:', error.message);
    }
  }
  
  // Check and setup wrapped SOL account
  try {
    const wsolAccount = await getAccount(provider.connection, userTokenB);
    const wsolBalance = Number(wsolAccount.amount) / 10**9;
    console.log('💰 Wrapped SOL balance:', wsolBalance.toFixed(9));
    
    if (wsolBalance < 1.0 && solBalance > 1.5 * LAMPORTS_PER_SOL) {
      console.log('🔄 Wrapping 1 SOL...');
      await wrapSol(provider, user, userTokenB, 1.0);
    }
  } catch (error) {
    console.log('💼 Creating wrapped SOL account...');
    try {
      const createSOLTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey, userTokenB, user.publicKey, tokenBMint
        )
      );
      await provider.connection.sendTransaction(createSOLTx, [user]);
      console.log('✅ Created wrapped SOL account:', userTokenB.toString());
      
      // Wrap some SOL
      if (solBalance > 1.5 * LAMPORTS_PER_SOL) {
        console.log('🔄 Wrapping 1 SOL...');
        await wrapSol(provider, user, userTokenB, 1.0);
      }
    } catch (error) {
      console.log('❌ Failed to create wrapped SOL account:', error.message);
    }
  }
  
  // Final status check
  console.log('\n📊 Final status:');
  await checkBalances();
  
  console.log('\n✅ Funding setup complete!');
  console.log('🎯 If you have tokens, continue with:');
  console.log('1. yarn init-protocol');
  console.log('2. yarn init-user');
  console.log('3. yarn create-position');
}

async function wrapSol(
  provider: anchor.AnchorProvider, 
  user: anchor.web3.Keypair, 
  wsolAccount: PublicKey, 
  amount: number
) {
  const wrapLamports = Math.floor(amount * LAMPORTS_PER_SOL);
  
  // Create transaction to wrap SOL
  const transaction = new anchor.web3.Transaction();
  
  // Transfer SOL to the wrapped SOL account
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: user.publicKey,
      toPubkey: wsolAccount,
      lamports: wrapLamports,
    })
  );
  
  // Sync native (converts SOL to wrapped SOL tokens)
  transaction.add(createSyncNativeInstruction(wsolAccount));
  
  try {
    const txSignature = await provider.connection.sendTransaction(transaction, [user]);
    await provider.connection.confirmTransaction(txSignature);
    
    console.log('✅ Wrapped', amount, 'SOL successfully!');
    
    // Check new balance
    const account = await getAccount(provider.connection, wsolAccount);
    console.log('💰 New wrapped SOL balance:', (Number(account.amount) / 10**9).toFixed(9));
    
  } catch (error) {
    console.error('❌ Error wrapping SOL:', error.message);
  }
}

async function checkBalances() {
  try {
    const state = loadState();
    const user = loadUserKeypair();
    const provider = anchor.AnchorProvider.env();
    
    const solBalance = await provider.connection.getBalance(user.publicKey);
    console.log('SOL:', (solBalance / LAMPORTS_PER_SOL).toFixed(4));
    
    try {
      const tokenAAccount = await getAccount(provider.connection, new PublicKey(state.userTokenA));
      console.log('USDC:', (Number(tokenAAccount.amount) / 10**6).toFixed(6));
    } catch {
      console.log('USDC: Account not found');
    }
    
    try {
      const tokenBAccount = await getAccount(provider.connection, new PublicKey(state.userTokenB));
      console.log('Wrapped SOL:', (Number(tokenBAccount.amount) / 10**9).toFixed(9));
    } catch {
      console.log('Wrapped SOL: Account not found');
    }
  } catch (error) {
    console.log('❌ Error checking balances:', error.message);
  }
}

if (require.main === module) {
  fundDevnetUser().catch(console.error);
}
