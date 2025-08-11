// scripts/utils/close-all-accounts.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount, closeAccount } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';
import { existsSync, unlinkSync } from 'fs';

interface AccountToClose {
  name: string;
  publicKey: PublicKey;
  type: 'position' | 'token' | 'user' | 'protocol';
  canClose: boolean;
  reason?: string;
}

async function closeAllAccounts() {
  console.log('🧹 Capital Reallocator Account Cleanup Utility');
  console.log('===============================================\n');
  
  // Check if state file exists
  if (!existsSync('./scripts/state.json')) {
    console.log('❌ No state file found. Nothing to clean up.');
    return;
  }
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  const isDevnet = provider.connection.rpcEndpoint.includes('devnet');
  
  console.log('🌐 Connected to:', provider.connection.rpcEndpoint);
  console.log('👤 User:', user.publicKey.toString());
  console.log('🗂️  Environment:', isDevnet ? 'DEVNET' : 'LOCAL');
  
  // Check SOL balance
  const solBalance = await provider.connection.getBalance(user.publicKey);
  console.log('💰 SOL balance:', (solBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Low SOL balance for transaction fees');
  }
  
  console.log('\n📋 Analyzing accounts...\n');
  
  // Collect all accounts to potentially close
  const accountsToClose: AccountToClose[] = [];
  
  // Check position account
  if (state.position) {
    const positionPubkey = new PublicKey(state.position);
    try {
      const positionState = await program.account.position.fetch(positionPubkey);
      
      // Check if position is empty
      const totalA = positionState.tokenAVaultBalance.toNumber() + 
                     positionState.tokenAInLp.toNumber() + 
                     positionState.tokenAInLending.toNumber();
      const totalB = positionState.tokenBVaultBalance.toNumber() + 
                     positionState.tokenBInLp.toNumber() + 
                     positionState.tokenBInLending.toNumber();
      
      const isEmpty = totalA === 0 && totalB === 0;
      
      accountsToClose.push({
        name: `Position ${positionState.positionId.toString()}`,
        publicKey: positionPubkey,
        type: 'position',
        canClose: isEmpty,
        reason: isEmpty ? 'Empty position' : `Has ${totalA / 1e6} A + ${totalB / 1e9} B tokens`
      });
      
      console.log(`📊 Position ${positionState.positionId.toString()}:`);
      console.log(`   Address: ${positionPubkey.toString()}`);
      console.log(`   Status: ${isEmpty ? '✅ Empty (can close)' : '❌ Contains tokens'}`);
      console.log(`   Balances: ${totalA / 1e6} A, ${totalB / 1e9} B`);
      
    } catch (error) {
      console.log(`📊 Position: Account doesn't exist (already closed)`);
    }
  }
  
  // Check position token vaults
  if (state.positionTokenAVault) {
    try {
      const vaultAccount = await getAccount(provider.connection, new PublicKey(state.positionTokenAVault));
      const isEmpty = Number(vaultAccount.amount) === 0;
      
      accountsToClose.push({
        name: 'Position Token A Vault',
        publicKey: new PublicKey(state.positionTokenAVault),
        type: 'token',
        canClose: isEmpty,
        reason: isEmpty ? 'Empty vault' : `Contains ${Number(vaultAccount.amount) / 1e6} tokens`
      });
      
      console.log(`💼 Position Token A Vault:`);
      console.log(`   Address: ${state.positionTokenAVault}`);
      console.log(`   Balance: ${(Number(vaultAccount.amount) / 1e6).toFixed(6)}`);
      console.log(`   Status: ${isEmpty ? '✅ Empty (can close)' : '❌ Contains tokens'}`);
      
    } catch (error) {
      console.log(`💼 Position Token A Vault: Account doesn't exist`);
    }
  }
  
  if (state.positionTokenBVault) {
    try {
      const vaultAccount = await getAccount(provider.connection, new PublicKey(state.positionTokenBVault));
      const isEmpty = Number(vaultAccount.amount) === 0;
      
      accountsToClose.push({
        name: 'Position Token B Vault',
        publicKey: new PublicKey(state.positionTokenBVault),
        type: 'token',
        canClose: isEmpty,
        reason: isEmpty ? 'Empty vault' : `Contains ${Number(vaultAccount.amount) / 1e9} tokens`
      });
      
      console.log(`💼 Position Token B Vault:`);
      console.log(`   Address: ${state.positionTokenBVault}`);
      console.log(`   Balance: ${(Number(vaultAccount.amount) / 1e9).toFixed(9)}`);
      console.log(`   Status: ${isEmpty ? '✅ Empty (can close)' : '❌ Contains tokens'}`);
      
    } catch (error) {
      console.log(`💼 Position Token B Vault: Account doesn't exist`);
    }
  }
  
  // Check user main account
  if (state.userMainAccount) {
    try {
      const userState = await program.account.userMainAccount.fetch(new PublicKey(state.userMainAccount));
      const hasPositions = userState.positionCount.toNumber() > 0;
      
      accountsToClose.push({
        name: 'User Main Account',
        publicKey: new PublicKey(state.userMainAccount),
        type: 'user',
        canClose: !hasPositions,
        reason: hasPositions ? `Has ${userState.positionCount.toString()} active positions` : 'No active positions'
      });
      
      console.log(`👤 User Main Account:`);
      console.log(`   Address: ${state.userMainAccount}`);
      console.log(`   Active positions: ${userState.positionCount.toString()}`);
      console.log(`   Total created: ${userState.totalPositionsCreated.toString()}`);
      console.log(`   Status: ${!hasPositions ? '✅ Can close' : '❌ Has active positions'}`);
      
    } catch (error) {
      console.log(`👤 User Main Account: Account doesn't exist`);
    }
  }
  
  // Check protocol authority (usually shouldn't close this)
  if (state.protocolAuthority) {
    try {
      const protocolState = await program.account.protocolAuthority.fetch(new PublicKey(state.protocolAuthority));
      
      accountsToClose.push({
        name: 'Protocol Authority',
        publicKey: new PublicKey(state.protocolAuthority),
        type: 'protocol',
        canClose: false, // Generally shouldn't close protocol authority
        reason: `Global protocol state (${protocolState.totalPositions.toString()} total positions)`
      });
      
      console.log(`🏛️  Protocol Authority:`);
      console.log(`   Address: ${state.protocolAuthority}`);
      console.log(`   Total positions: ${protocolState.totalPositions.toString()}`);
      console.log(`   Fee BPS: ${protocolState.protocolFeeBps}`);
      console.log(`   Status: 🔒 Global state (keep)`);
      
    } catch (error) {
      console.log(`🏛️  Protocol Authority: Account doesn't exist`);
    }
  }
  
  // Check user token accounts
  if (state.userTokenA) {
    try {
      const tokenAccount = await getAccount(provider.connection, new PublicKey(state.userTokenA));
      console.log(`💰 User Token A Account:`);
      console.log(`   Address: ${state.userTokenA}`);
      console.log(`   Balance: ${(Number(tokenAccount.amount) / 1e6).toFixed(6)}`);
      console.log(`   Status: 💎 Keep (your tokens)`);
    } catch (error) {
      console.log(`💰 User Token A Account: Account doesn't exist`);
    }
  }
  
  if (state.userTokenB) {
    try {
      const tokenAccount = await getAccount(provider.connection, new PublicKey(state.userTokenB));
      console.log(`💰 User Token B Account:`);
      console.log(`   Address: ${state.userTokenB}`);
      console.log(`   Balance: ${(Number(tokenAccount.amount) / 1e9).toFixed(9)}`);
      console.log(`   Status: 💎 Keep (your tokens)`);
    } catch (error) {
      console.log(`💰 User Token B Account: Account doesn't exist`);
    }
  }
  
  // Summary
  const canCloseCount = accountsToClose.filter(acc => acc.canClose).length;
  const totalCount = accountsToClose.length;
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total accounts analyzed: ${totalCount}`);
  console.log(`   Can be closed: ${canCloseCount}`);
  console.log(`   Must keep: ${totalCount - canCloseCount}`);
  
  if (canCloseCount === 0) {
    console.log('\n✅ No accounts need to be closed.');
    console.log('💡 To close positions, first withdraw all tokens:');
    console.log('   yarn withdraw 100');
    console.log('   yarn close-position');
    return;
  }
  
  // Show cleanup plan
  console.log(`\n🧹 Cleanup Plan:`);
  accountsToClose.forEach(acc => {
    if (acc.canClose) {
      console.log(`   ✅ Close ${acc.name}: ${acc.reason}`);
    } else {
      console.log(`   ⏭️  Keep ${acc.name}: ${acc.reason}`);
    }
  });
  
  // Prompt for confirmation
  console.log(`\n⚠️  About to close ${canCloseCount} accounts.`);
  console.log('💰 This will recover SOL rent to your wallet.');
  console.log('🔄 Continue? This action cannot be undone.');
  
  // In a real interactive environment, you might want to prompt for confirmation
  const shouldProceed = process.argv.includes('--confirm') || process.argv.includes('-y');
  
  if (!shouldProceed) {
    console.log('\n❌ Cancelled. To proceed, run with --confirm flag:');
    console.log('   yarn close-accounts --confirm');
    return;
  }
  
  console.log('\n🔧 Executing cleanup...\n');
  
  let closedCount = 0;
  let recoveredSol = 0;
  
  // Close accounts in proper order
  for (const account of accountsToClose) {
    if (!account.canClose) continue;
    
    try {
      console.log(`🔨 Closing ${account.name}...`);
      
      const balanceBefore = await provider.connection.getBalance(user.publicKey);
      
      if (account.type === 'position') {
        // Close position using program instruction
        await program.methods
          .closePosition()
          .accountsPartial({
            position: account.publicKey,
            userMainAccount: new PublicKey(state.userMainAccount),
            protocolAuthority: new PublicKey(state.protocolAuthority),
            positionTokenAVault: new PublicKey(state.positionTokenAVault),
            positionTokenBVault: new PublicKey(state.positionTokenBVault),
            tokenAMint: new PublicKey(state.tokenAMint),
            tokenBMint: new PublicKey(state.tokenBMint),
            owner: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
          
      } else if (account.type === 'token') {
        // Close token account
        await closeAccount(
          provider.connection,
          user,
          account.publicKey,
          user.publicKey,
          user
        );
      }
      
      const balanceAfter = await provider.connection.getBalance(user.publicKey);
      const recovered = (balanceAfter - balanceBefore) / LAMPORTS_PER_SOL;
      
      console.log(`   ✅ Closed! Recovered ${recovered.toFixed(6)} SOL`);
      closedCount++;
      recoveredSol += recovered;
      
    } catch (error: any) {
      console.log(`   ❌ Failed to close ${account.name}: ${error.message}`);
    }
  }
  
  console.log(`\n🎉 Cleanup complete!`);
  console.log(`   Accounts closed: ${closedCount}`);
  console.log(`   SOL recovered: ${recoveredSol.toFixed(6)}`);
  
  // Clean up state file
  if (closedCount > 0) {
    console.log(`\n🗑️  Cleaning up state file...`);
    
    // Remove closed accounts from state
    const updatedState = { ...state };
    
    // Remove position-related entries if position was closed
    if (accountsToClose.some(acc => acc.type === 'position' && acc.canClose)) {
      delete updatedState.position;
      delete updatedState.positionId;
      delete updatedState.positionTokenAVault;
      delete updatedState.positionTokenBVault;
    }
    
    // If everything is closed, remove state file entirely
    const hasAnyAccounts = updatedState.position || updatedState.userMainAccount;
    
    if (!hasAnyAccounts) {
      unlinkSync('./scripts/state.json');
      console.log(`   ✅ Removed state file (no accounts remaining)`);
    } else {
      require('fs').writeFileSync('./scripts/state.json', JSON.stringify(updatedState, null, 2));
      console.log(`   ✅ Updated state file`);
    }
  }
  
  // Final balance
  const finalBalance = await provider.connection.getBalance(user.publicKey);
  console.log(`\n💰 Final SOL balance: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(6)}`);
  
  console.log(`\n📝 Next steps:`);
  if (recoveredSol > 0) {
    console.log(`   - ${recoveredSol.toFixed(6)} SOL was recovered to your wallet`);
  }
  if (closedCount === 0) {
    console.log(`   - Withdraw tokens first: yarn withdraw 100`);
    console.log(`   - Then close positions: yarn close-position`);
  } else {
    console.log(`   - Cleanup successful! You can start fresh with: yarn setup`);
  }
}

// Helper function to get explorer URL
function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

// Command line options
if (require.main === module) {
  console.log('Capital Reallocator - Account Cleanup');
  console.log('====================================');
  
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('\nUsage: yarn close-accounts [options]');
    console.log('\nOptions:');
    console.log('  --confirm, -y    Skip confirmation prompt');
    console.log('  --help, -h       Show this help message');
    console.log('\nThis script will:');
    console.log('  1. Analyze all accounts created by the program');
    console.log('  2. Close empty positions and token accounts');
    console.log('  3. Recover SOL rent to your wallet');
    console.log('  4. Clean up the state file');
    console.log('\nNote: Only empty accounts can be closed.');
    console.log('Withdraw all tokens first using: yarn withdraw 100');
    process.exit(0);
  }
  
  closeAllAccounts().catch(console.error);
}
