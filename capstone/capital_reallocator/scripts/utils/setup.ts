// scripts/utils/setup.ts
import * as anchor from "@coral-xyz/anchor";
import bs58 from 'bs58';
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  createMint, 
  createAccount, 
  mintTo,
  getAccount
} from "@solana/spl-token";
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = './scripts/state.json';

interface TestState {
  user: string;
  userPublicKey: string;
  userSecretKeyBase58: string;
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
  
  const isDevnet = provider.connection.rpcEndpoint.includes('devnet');
  
  // Only airdrop on local, not devnet
  if (!isDevnet) {
    console.log('💸 Requesting SOL airdrop...');
    const signature = await provider.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(signature);
    
    const balance = await provider.connection.getBalance(user.publicKey);
    console.log('✅ User balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  } else {
    console.log('💡 Devnet detected - skipping automatic funding');
  }

  // Create or use existing token mints
  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  
  if (isDevnet) {
    // Use real USDC and SOL on devnet
    tokenAMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC
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
    
    // Create accounts if they don't exist (will fail if no SOL, that's ok)
    try {
      await getAccount(provider.connection, userTokenA);
      console.log('✅ USDC account already exists');
    } catch {
      try {
        const createUSDCTx = new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            user.publicKey, userTokenA, user.publicKey, tokenAMint
          )
        );
        await provider.connection.sendTransaction(createUSDCTx, [user]);
        console.log('✅ Created USDC account');
      } catch (error) {
        console.log('⚠️  Could not create USDC account (need SOL first)');
      }
    }
    
    try {
      await getAccount(provider.connection, userTokenB);
      console.log('✅ Wrapped SOL account already exists');
    } catch {
      try {
        const createSOLTx = new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            user.publicKey, userTokenB, user.publicKey, tokenBMint
          )
        );
        await provider.connection.sendTransaction(createSOLTx, [user]);
        console.log('✅ Created wrapped SOL account');
      } catch (error) {
        console.log('⚠️  Could not create wrapped SOL account (need SOL first)');
      }
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
    
    // Fund local accounts immediately
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
    userPublicKey: user.publicKey.toString(),
    userSecretKeyBase58: bs58.encode(user.secretKey),
    tokenAMint: tokenAMint.toString(),
    tokenBMint: tokenBMint.toString(),
    userTokenA: userTokenA.toString(),
    userTokenB: userTokenB.toString(),
    protocolAuthority: protocolAuthority.toString(),
    userMainAccount: userMainAccount.toString(),
  };

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('💾 Saved state to:', STATE_FILE);

  console.log('\n✅ Setup complete!');
  
  if (isDevnet) {
    console.log('\n📋 Next steps for devnet:');
    console.log('1. Get SOL from: https://faucet.solana.com/');
    console.log('   Your address: ' + user.publicKey.toString());
    console.log('2. Get USDC from: https://faucet.circle.com/');
    console.log('   Your address: ' + user.publicKey.toString());
    console.log('3. Run: yarn fund  (to create accounts and wrap SOL)');
    console.log('4. Then: yarn init-protocol');
  } else {
    console.log('\n🎯 Next steps:');
    console.log('1. yarn init-protocol');
    console.log('2. yarn init-user');
    console.log('3. yarn create-position');
  }
}

export function loadState(): TestState {
  if (!existsSync(STATE_FILE)) {
    throw new Error('State file not found. Run setup first: yarn setup');
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
