// scripts/utils/setup.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  createMint, 
  createAccount, 
  mintTo,
  getAccount,
  createSyncNativeInstruction
} from "@solana/spl-token";
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = './scripts/state.json';

interface TestState {
  user: string;
  tokenAMint: string;
  tokenBMint: string;
  userTokenA: string;
  userTokenB: string;
  protocolAuthority: string;
  userMainAccount: string;
  
  // Added by init-protocol.ts
  feeRecipient?: string;
  feeRecipientSecretKey?: string;
  feeTokenA?: string;
  feeTokenB?: string;
  
  // Added by create-position.ts
  position?: string;
  positionId?: string;
  positionTokenAVault?: string;
  positionTokenBVault?: string;
}

async function fundDevnetAccounts(
  provider: anchor.AnchorProvider, 
  user: Keypair, 
  userTokenA: PublicKey, 
  userTokenB: PublicKey
) {
  console.log('💰 Setting up devnet token funding...');
  
  // Check SOL balance
  const solBalance = await provider.connection.getBalance(user.publicKey);
  console.log('💰 SOL balance:', (solBalance / LAMPORTS_PER_SOL).toFixed(4));
  
  if (solBalance < 2 * LAMPORTS_PER_SOL) {
    console.log('💸 Getting more SOL...');
    try {
      const signature = await provider.connection.requestAirdrop(
        user.publicKey, 
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(signature);
      console.log('✅ Airdropped 2 SOL');
    } catch (error) {
      console.log('⚠️  Airdrop failed, you may need SOL manually');
    }
  }
  
  // Check USDC balance
  try {
    const usdcAccount = await getAccount(provider.connection, userTokenA);
    const usdcBalance = Number(usdcAccount.amount) / 10**6;
    console.log('💵 USDC balance:', usdcBalance.toFixed(6));
    
    if (usdcBalance === 0) {
      console.log('');
      console.log('🎯 To get USDC:');
      console.log('1. Visit: https://faucet.circle.com/');
      console.log('2. Enter your address:', user.publicKey.toString());
      console.log('3. Select Solana Devnet and request USDC');
      console.log('');
    }
  } catch (error) {
    console.log('💵 USDC balance: 0 (account created, needs funding)');
  }
  
  // Handle wrapped SOL
  console.log('🔄 Setting up wrapped SOL...');
  
  try {
    const wsolAccount = await getAccount(provider.connection, userTokenB);
    const wsolBalance = Number(wsolAccount.amount) / 10**9;
    console.log('💰 Wrapped SOL balance:', wsolBalance.toFixed(9));
    
    if (wsolBalance < 1.0) {
      await wrapSol(provider, user, userTokenB, 1.5); // Wrap 1.5 SOL
    }
  } catch (error) {
    // Account exists but empty, wrap some SOL
    await wrapSol(provider, user, userTokenB, 1.5);
  }
  
  console.log('');
  console.log('✅ Devnet funding setup complete!');
  console.log('💡 Run the init-protocol step next');
}

async function wrapSol(
  provider: anchor.AnchorProvider, 
  user: Keypair, 
  wsolAccount: PublicKey, 
  amount: number
) {
  console.log(`🔄 Wrapping ${amount} SOL...`);
  
  const wrapLamports = amount * LAMPORTS_PER_SOL;
  
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
    
    console.log('✅ Wrapped SOL successfully!');
    console.log('🔗 View transaction:', 
      `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
    
    // Check new balance
    const account = await getAccount(provider.connection, wsolAccount);
    console.log('💰 Wrapped SOL balance:', (Number(account.amount) / 10**9).toFixed(9));
    
  } catch (error) {
    console.error('❌ Error wrapping SOL:', error);
  }
}

async function setupTestEnvironment() {
  console.log('🏗️  Setting up test environment...');
  
  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  console.log('🌐 Connected to:', provider.connection.rpcEndpoint);
  console.log('📋 Program ID:', program.programId.toString());

  // Create user keypair
  const user = Keypair.generate();
  console.log('👤 Created user:', user.publicKey.toString());
  
  // Airdrop SOL
  console.log('💸 Requesting SOL airdrop...');
  const signature = await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(signature);
  
  const balance = await provider.connection.getBalance(user.publicKey);
  console.log('✅ User balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  // Create or use existing token mints
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  
  const isDevnet = provider.connection.rpcEndpoint.includes('devnet');
  
  if (isDevnet) {
    // Use real USDC and SOL on devnet
    tokenAMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
    tokenBMint = new PublicKey('So11111111111111111111111111111111111111112'); // SOL (wrapped)
    console.log('🌐 Using devnet tokens:');
    console.log('🪙 USDC:', tokenAMint.toString());
    console.log('🪙 SOL (wrapped):', tokenBMint.toString());
  } else {
    // Create test tokens for local testing
    console.log('🏭 Creating test token mints...');
    tokenAMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6 // USDC decimals
    );
    console.log('🪙 Token A (USDC-like):', tokenAMint.toString());

    tokenBMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      9 // SOL decimals
    );
    console.log('🪙 Token B (SOL-like):', tokenBMint.toString());
  }

  // Create user token accounts
  console.log('💼 Creating user token accounts...');
  let userTokenA: PublicKey;
  let userTokenB: PublicKey;
  
  if (isDevnet) {
    // Use associated token accounts for real tokens
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
    
    userTokenA = await getAssociatedTokenAddress(tokenAMint, user.publicKey);
    userTokenB = await getAssociatedTokenAddress(tokenBMint, user.publicKey);
    
    console.log('💼 USDC account:', userTokenA.toString());
    console.log('💼 Wrapped SOL account:', userTokenB.toString());
    
    // Create accounts if they don't exist
    try {
      await getAccount(provider.connection, userTokenA);
    } catch {
      const createUSDCTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey, userTokenA, user.publicKey, tokenAMint
        )
      );
      await provider.connection.sendTransaction(createUSDCTx, [user]);
      console.log('✅ Created USDC account');
    }
    
    try {
      await getAccount(provider.connection, userTokenB);
    } catch {
      const createSOLTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          user.publicKey, userTokenB, user.publicKey, tokenBMint
        )
      );
      await provider.connection.sendTransaction(createSOLTx, [user]);
      console.log('✅ Created wrapped SOL account');
    }
  } else {
    // Local testing - create regular token accounts
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
  }

  // Fund token accounts
  console.log('🪙 Funding user token accounts...');
  
  if (isDevnet) {
    // Fund devnet accounts with real tokens
    await fundDevnetAccounts(provider, user, userTokenA, userTokenB);
  } else {
    // Local testing - mint test tokens
    await mintTo(
      provider.connection,
      user,
      tokenAMint,
      userTokenA,
      user,
      1000000 * 10**6 // 1M Token A
    );

    await mintTo(
      provider.connection,
      user,
      tokenBMint,
      userTokenB,
      user,
      10000 * 10**9 // 10K Token B
    );
    console.log('✅ Minted 1,000,000 Token A and 10,000 Token B');
  }

  // Derive PDAs
  console.log('🔑 Deriving program accounts...');
  const [protocolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    program.programId
  );

  const [userMainAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), user.publicKey.toBuffer()],
    program.programId
  );

  console.log('📋 Protocol Authority:', protocolAuthority.toString());
  console.log('👤 User Main Account:', userMainAccount.toString());

  // Save state to file for other scripts
  const state: TestState = {
    user: JSON.stringify(Array.from(user.secretKey)),
    tokenAMint: tokenAMint.toString(),
    tokenBMint: tokenBMint.toString(),
    userTokenA: userTokenA.toString(),
    userTokenB: userTokenB.toString(),
    protocolAuthority: protocolAuthority.toString(),
    userMainAccount: userMainAccount.toString(),
  };

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('💾 Saved state to:', STATE_FILE);

  console.log('\n✅ Setup complete! You can now:');
  console.log('1. Run: npx ts-node scripts/utils/init-protocol.ts');
  console.log('2. Run: npx ts-node scripts/utils/init-user.ts');
  console.log('3. Run: npx ts-node scripts/utils/create-position.ts');

  return {
    user,
    tokenAMint,
    tokenBMint,
    userTokenA,
    userTokenB,
    protocolAuthority,
    userMainAccount,
    program
  };
}

export function loadState(): TestState {
  if (!existsSync(STATE_FILE)) {
    throw new Error('State file not found. Run setup first: npx ts-node scripts/utils/setup.ts');
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

export function loadUserKeypair(): Keypair {
  const state = loadState();
  const secretKey = new Uint8Array(JSON.parse(state.user));
  return Keypair.fromSecretKey(secretKey);
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupTestEnvironment().catch(console.error);
}
