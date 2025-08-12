// scripts/utils/init-protocol.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';
import { writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

// Load local dev keypair as fee recipient
function loadDevKeypair(): Keypair {
  const devKeypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  try {
    const secretKey = JSON.parse(readFileSync(devKeypairPath, 'utf8'));
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } catch (error) {
    throw new Error(`Could not load dev keypair from ${devKeypairPath}: ${error.message}`);
  }
}

// Detect which token program owns a mint
async function getTokenProgram(connection: anchor.web3.Connection, mint: PublicKey): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    throw new Error(`Mint ${mint.toString()} not found`);
  }
  
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    console.log(`🆕 ${mint.toString().slice(0,8)}... uses Token-2022`);
    return TOKEN_2022_PROGRAM_ID;
  } else if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    console.log(`🏛️  ${mint.toString().slice(0,8)}... uses Legacy SPL Token`);
    return TOKEN_PROGRAM_ID;
  } else {
    throw new Error(`Invalid token mint ${mint.toString()} - owner: ${mintInfo.owner.toString()}`);
  }
}

async function initializeProtocol() {
  console.log('🚀 Initializing protocol...');
  
  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  const user = loadUserKeypair();
  const state = loadState();
  
  // Use local dev account as fee recipient
  const feeRecipient = loadDevKeypair();
  console.log('💰 Fee recipient (dev account):', feeRecipient.publicKey.toString());
  
  const protocolAuthority = new PublicKey(state.protocolAuthority);
  
  // Check if protocol is already initialized
  try {
    const protocolAccount = await program.account.protocolAuthority.fetch(protocolAuthority);
    console.log('✅ Protocol already initialized!');
    console.log('📋 Protocol Authority:', protocolAuthority.toString());
    console.log('💰 Fee Recipient:', protocolAccount.fee_recipient.toString());
    console.log('📊 Protocol Fee:', protocolAccount.protocol_fee_bps, 'bps');
    console.log('🔢 Total Positions:', protocolAccount.total_positions.toString());
    
    // Still create fee recipient token accounts if they don't exist
    await ensureFeeRecipientAccounts(program, user, state, protocolAccount.fee_recipient);
    return;
  } catch (error) {
    console.log('🆕 Protocol not initialized, creating...');
  }
  
  // Get token mints and detect their programs
  const tokenAMint = new PublicKey(state.tokenAMint);
  const tokenBMint = new PublicKey(state.tokenBMint);
  
  // Detect token programs
  const tokenAProgram = await getTokenProgram(provider.connection, tokenAMint);
  const tokenBProgram = await getTokenProgram(provider.connection, tokenBMint);
  
  // Get associated token addresses with correct programs
  const feeTokenA = await getAssociatedTokenAddress(
    tokenAMint, 
    feeRecipient.publicKey,
    false, // allowOwnerOffCurve
    tokenAProgram
  );
  
  const feeTokenB = await getAssociatedTokenAddress(
    tokenBMint, 
    feeRecipient.publicKey,
    false,
    tokenBProgram
  );
  
  console.log('💼 Fee Token A account:', feeTokenA.toString());
  console.log('💼 Fee Token B account:', feeTokenB.toString());
  
  // Create associated token accounts with correct programs
  const createFeeAccountsIx = [];
  
  // Check if accounts exist first
  const feeTokenAInfo = await provider.connection.getAccountInfo(feeTokenA);
  const feeTokenBInfo = await provider.connection.getAccountInfo(feeTokenB);
  
  if (feeTokenAInfo) {
    console.log('✅ Fee Token A account already exists');
  } else {
    console.log('🏗️ Creating Fee Token A account...');
    createFeeAccountsIx.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,     // payer
        feeTokenA,         // ata
        feeRecipient.publicKey, // owner
        tokenAMint,        // mint
        tokenAProgram      // programId
      )
    );
  }
  
  if (feeTokenBInfo) {
    console.log('✅ Fee Token B account already exists');
  } else {
    console.log('🏗️ Creating Fee Token B account...');
    createFeeAccountsIx.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        feeTokenB,
        feeRecipient.publicKey,
        tokenBMint,
        tokenBProgram
      )
    );
  }
  
  // Create accounts if needed
  if (createFeeAccountsIx.length > 0) {
    console.log(`🚀 Creating ${createFeeAccountsIx.length} fee token account(s)...`);
    const createAccountsTx = new anchor.web3.Transaction().add(...createFeeAccountsIx);
    const signature = await provider.connection.sendTransaction(createAccountsTx, [user]);
    
    // Wait for confirmation
    await provider.connection.confirmTransaction(signature);
    console.log('✅ Created fee recipient token accounts');
    console.log('📝 Transaction:', signature);
  }
  
  try {
    // Initialize protocol with 0.5% fee (50 bps)
    await program.methods
      .initializeProtocol(50)
      .accountsPartial({
        protocolAuthority,
        feeRecipient: feeRecipient.publicKey,
        payer: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();
      
    console.log('✅ Protocol initialized successfully!');
    console.log('📋 Protocol Authority:', protocolAuthority.toString());
    console.log('💰 Fee Recipient:', feeRecipient.publicKey.toString());
    console.log('📊 Protocol Fee: 50 bps (0.5%)');
    
    // Update state file with camelCase field names
    const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
    currentState.feeRecipient = feeRecipient.publicKey.toString();
    currentState.feeTokenA = feeTokenA.toString();
    currentState.feeTokenB = feeTokenB.toString();
    
    writeFileSync('./scripts/state.json', JSON.stringify(currentState, null, 2));
    console.log('💾 Updated state file with fee recipient info');
    
  } catch (error) {
    console.error('❌ Failed to initialize protocol:', error);
    // If it's the "already in use" error, provide helpful message
    if (error.message?.includes('already in use')) {
      console.log('\n🔧 Troubleshooting steps:');
      console.log('1. Run: yarn clean');
      console.log('2. Restart validator: yarn validator');
      console.log('3. Redeploy: yarn build && yarn deploy');
      console.log('4. Setup again: yarn setup');
      console.log('5. Try init-protocol again');
    }
    throw error;
  }
}

async function ensureFeeRecipientAccounts(
  program: Program<CapitalReallocator>, 
  user: Keypair, 
  state: any, 
  feeRecipient: PublicKey
) {
  const provider = anchor.AnchorProvider.env();
  const tokenAMint = new PublicKey(state.tokenAMint);
  const tokenBMint = new PublicKey(state.tokenBMint);
  
  const tokenAProgram = await getTokenProgram(provider.connection, tokenAMint);
  const tokenBProgram = await getTokenProgram(provider.connection, tokenBMint);
  
  const feeTokenA = await getAssociatedTokenAddress(tokenAMint, feeRecipient, false, tokenAProgram);
  const feeTokenB = await getAssociatedTokenAddress(tokenBMint, feeRecipient, false, tokenBProgram);
  
  console.log('💼 Fee Token A account:', feeTokenA.toString());
  console.log('💼 Fee Token B account:', feeTokenB.toString());
  
  // Check if accounts exist and create if needed
  const accountsToCreate = [];
  
  const feeTokenAInfo = await provider.connection.getAccountInfo(feeTokenA);
  const feeTokenBInfo = await provider.connection.getAccountInfo(feeTokenB);
  
  if (!feeTokenAInfo) {
    console.log('🏗️ Need to create Fee Token A account');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        feeTokenA,
        feeRecipient,
        tokenAMint,
        tokenAProgram
      )
    );
  }
  
  if (!feeTokenBInfo) {
    console.log('🏗️ Need to create Fee Token B account');
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        feeTokenB,
        feeRecipient,
        tokenBMint,
        tokenBProgram
      )
    );
  }
  
  if (accountsToCreate.length > 0) {
    const createAccountsTx = new anchor.web3.Transaction().add(...accountsToCreate);
    const signature = await provider.connection.sendTransaction(createAccountsTx, [user]);
    await provider.connection.confirmTransaction(signature);
    console.log('✅ Created missing fee token accounts');
    console.log('📝 Transaction:', signature);
  }
  
  // Update state with camelCase field names
  const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
  if (!currentState.feeTokenA) {  // Check camelCase field
    currentState.feeRecipient = feeRecipient.toString();
    currentState.feeTokenA = feeTokenA.toString();
    currentState.feeTokenB = feeTokenB.toString();
    writeFileSync('./scripts/state.json', JSON.stringify(currentState, null, 2));
    console.log('💾 Updated state file with fee account info');
  }
}

// Run if this file is executed directly
if (require.main === module) {
  initializeProtocol().catch(console.error);
}
