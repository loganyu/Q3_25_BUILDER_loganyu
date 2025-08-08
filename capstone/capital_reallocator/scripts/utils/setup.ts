// scripts/utils/setup.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  createMint, 
  createAccount, 
  mintTo
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

  // Create token mints
  console.log('🏭 Creating token mints...');
  const tokenAMint = await createMint(
    provider.connection,
    user,
    user.publicKey,
    null,
    6 // USDC-like decimals
  );
  console.log('🪙 Token A (USDC-like):', tokenAMint.toString());

  const tokenBMint = await createMint(
    provider.connection,
    user,
    user.publicKey,
    null,
    9 // SOL-like decimals
  );
  console.log('🪙 Token B (SOL-like):', tokenBMint.toString());

  // Create user token accounts
  console.log('💼 Creating user token accounts...');
  const userTokenA = await createAccount(
    provider.connection,
    user,
    tokenAMint,
    user.publicKey
  );

  const userTokenB = await createAccount(
    provider.connection,
    user,
    tokenBMint,
    user.publicKey
  );

  // Mint tokens to user
  console.log('🪙 Minting tokens to user...');
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
