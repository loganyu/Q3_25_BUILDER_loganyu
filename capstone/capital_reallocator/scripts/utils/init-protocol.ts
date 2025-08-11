// scripts/utils/init-protocol.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';
import { writeFileSync, readFileSync } from 'fs';

async function initializeProtocol() {
  console.log('🚀 Initializing protocol...');
  
  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  const user = loadUserKeypair();
  const state = loadState();
  
  const protocolAuthority = new PublicKey(state.protocolAuthority);
  
  // Check if protocol is already initialized
  try {
    const protocolAccount = await program.account.protocolAuthority.fetch(protocolAuthority);
    console.log('✅ Protocol already initialized!');
    console.log('📋 Protocol Authority:', protocolAuthority.toString());
    console.log('💰 Fee Recipient:', protocolAccount.feeRecipient.toString());
    console.log('📊 Protocol Fee:', protocolAccount.protocolFeeBps, 'bps');
    console.log('🔢 Total Positions:', protocolAccount.totalPositions.toString());
    
    // Still create fee recipient token accounts if they don't exist
    await ensureFeeRecipientAccounts(program, user, state, protocolAccount.feeRecipient);
    return;
  } catch (error) {
    // Account doesn't exist, proceed with initialization
    console.log('🆕 Protocol not initialized, creating...');
  }
  
  // Create fee recipient keypair
  const feeRecipient = Keypair.generate();
  console.log('💰 Fee recipient:', feeRecipient.publicKey.toString());
  
  // Create fee recipient token accounts
  const tokenAMint = new PublicKey(state.tokenAMint);
  const tokenBMint = new PublicKey(state.tokenBMint);
  
  const feeTokenA = await getAssociatedTokenAddress(tokenAMint, feeRecipient.publicKey);
  const feeTokenB = await getAssociatedTokenAddress(tokenBMint, feeRecipient.publicKey);
  
  console.log('💼 Fee Token A account:', feeTokenA.toString());
  console.log('💼 Fee Token B account:', feeTokenB.toString());
  
  // Create associated token accounts for fee recipient
  const createFeeAccountsIx = [
    createAssociatedTokenAccountInstruction(
      user.publicKey, feeTokenA, feeRecipient.publicKey, tokenAMint
    ),
    createAssociatedTokenAccountInstruction(
      user.publicKey, feeTokenB, feeRecipient.publicKey, tokenBMint
    )
  ];
  
  const createAccountsTx = new anchor.web3.Transaction().add(...createFeeAccountsIx);
  await provider.connection.sendTransaction(createAccountsTx, [user]);
  console.log('✅ Created fee recipient token accounts');
  
  try {
    // Initialize protocol with 0.5% fee (50 bps)
    await program.methods
      .initializeProtocol(50) // 0.5% fee
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
    
    // Update state file with fee recipient info
    const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
    currentState.feeRecipient = feeRecipient.publicKey.toString();
    currentState.feeRecipientSecretKey = JSON.stringify(Array.from(feeRecipient.secretKey));
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
  
  const feeTokenA = await getAssociatedTokenAddress(tokenAMint, feeRecipient);
  const feeTokenB = await getAssociatedTokenAddress(tokenBMint, feeRecipient);
  
  console.log('💼 Fee Token A account:', feeTokenA.toString());
  console.log('💼 Fee Token B account:', feeTokenB.toString());
  
  // Check if fee accounts exist, create if needed
  const accountsToCreate = [];
  
  try {
    await provider.connection.getAccountInfo(feeTokenA);
    console.log('✅ Fee Token A account exists');
  } catch {
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey, feeTokenA, feeRecipient, tokenAMint
      )
    );
  }
  
  try {
    await provider.connection.getAccountInfo(feeTokenB);
    console.log('✅ Fee Token B account exists');
  } catch {
    accountsToCreate.push(
      createAssociatedTokenAccountInstruction(
        user.publicKey, feeTokenB, feeRecipient, tokenBMint
      )
    );
  }
  
  if (accountsToCreate.length > 0) {
    const createAccountsTx = new anchor.web3.Transaction().add(...accountsToCreate);
    await provider.connection.sendTransaction(createAccountsTx, [user]);
    console.log('✅ Created missing fee recipient token accounts');
  }
  
  // Update state if not already there
  const currentState = JSON.parse(readFileSync('./scripts/state.json', 'utf8'));
  if (!currentState.feeTokenA) {
    currentState.feeRecipient = feeRecipient.toString();
    currentState.feeTokenA = feeTokenA.toString();
    currentState.feeTokenB = feeTokenB.toString();
    writeFileSync('./scripts/state.json', JSON.stringify(currentState, null, 2));
    console.log('💾 Updated state file with fee account info');
  }

  console.log('\n🎯 Next step: npx ts-node scripts/utils/init-user.ts');
}

// Run if this file is executed directly
if (require.main === module) {
  initializeProtocol().catch(console.error);
}
