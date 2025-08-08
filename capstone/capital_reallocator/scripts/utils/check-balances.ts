// scripts/utils/check-balances.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';

async function checkBalances() {
  console.log('📊 Checking all balances...');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  console.log('🌐 Connected to:', provider.connection.rpcEndpoint);
  console.log('👤 User:', user.publicKey.toString());
  
  // SOL Balance
  const solBalance = await provider.connection.getBalance(user.publicKey);
  console.log('\n💰 SOL Balance:', (solBalance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  // User Token Balances
  console.log('\n👤 User Token Balances:');
  try {
    const userAccountA = await getAccount(provider.connection, new PublicKey(state.userTokenA));
    const userAccountB = await getAccount(provider.connection, new PublicKey(state.userTokenB));
    
    console.log('Token A (6 decimals):', (Number(userAccountA.amount) / 10**6).toFixed(6));
    console.log('Token B (9 decimals):', (Number(userAccountB.amount) / 10**9).toFixed(9));
  } catch (error) {
    console.log('❌ Error fetching user token balances:', error.message);
  }
  
  // Position Information
  if (state.position) {
    console.log('\n📊 Position Information:');
    try {
      const positionState = await program.account.position.fetch(new PublicKey(state.position));
      
      console.log('Position ID:', positionState.positionId.toString());
      console.log('Owner:', positionState.owner.toString());
      console.log('Created at:', new Date(positionState.createdAt.toNumber() * 1000).toISOString());
      console.log('Paused:', positionState.pauseFlag);
      
      console.log('\nLP Range:');
      console.log('Min: $' + (positionState.lpRangeMin.toNumber() / 10**6).toFixed(2));
      console.log('Max: $' + (positionState.lpRangeMax.toNumber() / 10**6).toFixed(2));
      
      console.log('\n💼 Position Token Balances:');
      console.log('Vault Token A:', (positionState.tokenAVaultBalance.toNumber() / 10**6).toFixed(6));
      console.log('Vault Token B:', (positionState.tokenBVaultBalance.toNumber() / 10**9).toFixed(9));
      console.log('LP Token A:', (positionState.tokenAInLp.toNumber() / 10**6).toFixed(6));
      console.log('LP Token B:', (positionState.tokenBInLp.toNumber() / 10**9).toFixed(9));
      console.log('Lending Token A:', (positionState.tokenAInLending.toNumber() / 10**6).toFixed(6));
      console.log('Lending Token B:', (positionState.tokenBInLending.toNumber() / 10**9).toFixed(9));
      
      // Calculate totals
      const totalA = positionState.tokenAVaultBalance.toNumber() + 
                     positionState.tokenAInLp.toNumber() + 
                     positionState.tokenAInLending.toNumber();
      const totalB = positionState.tokenBVaultBalance.toNumber() + 
                     positionState.tokenBInLp.toNumber() + 
                     positionState.tokenBInLending.toNumber();
      
      console.log('\n📈 Total Position Value:');
      console.log('Total Token A:', (totalA / 10**6).toFixed(6));
      console.log('Total Token B:', (totalB / 10**9).toFixed(9));
      
      if (totalA === 0 && totalB === 0) {
        console.log('💡 Position is empty - can be closed');
      }
      
    } catch (error) {
      console.log('❌ Error fetching position:', error.message);
    }
  } else {
    console.log('\n📊 No position created yet');
  }
  
  // Protocol Information
  console.log('\n🏛️  Protocol Information:');
  try {
    const protocolState = await program.account.protocolAuthority.fetch(
      new PublicKey(state.protocolAuthority)
    );
    
    console.log('Fee BPS:', protocolState.protocolFeeBps, '(' + (protocolState.protocolFeeBps / 100).toFixed(2) + '%)');
    console.log('Fee Recipient:', protocolState.feeRecipient.toString());
    console.log('Total Positions:', protocolState.totalPositions.toString());
    
  } catch (error) {
    console.log('❌ Protocol not initialized yet');
  }
  
  // Fee Balances
  if (state.feeTokenA && state.feeTokenB) {
    console.log('\n💰 Protocol Fee Balances:');
    try {
      const feeAccountA = await getAccount(provider.connection, new PublicKey(state.feeTokenA));
      const feeAccountB = await getAccount(provider.connection, new PublicKey(state.feeTokenB));
      
      console.log('Fee Token A collected:', (Number(feeAccountA.amount) / 10**6).toFixed(6));
      console.log('Fee Token B collected:', (Number(feeAccountB.amount) / 10**9).toFixed(9));
      
    } catch (error) {
      console.log('❌ Error fetching fee balances:', error.message);
    }
  }
  
  // User Main Account
  if (state.userMainAccount) {
    console.log('\n👤 User Account Information:');
    try {
      const userState = await program.account.userMainAccount.fetch(
        new PublicKey(state.userMainAccount)
      );
      
      console.log('Position Count:', userState.positionCount.toString());
      console.log('Total Positions Created:', userState.totalPositionsCreated.toString());
      
    } catch (error) {
      console.log('❌ User account not initialized yet');
    }
  }
  
  // Account Addresses
  console.log('\n📋 Account Addresses:');
  console.log('Token A Mint:', state.tokenAMint);
  console.log('Token B Mint:', state.tokenBMint);
  console.log('User Token A:', state.userTokenA);
  console.log('User Token B:', state.userTokenB);
  if (state.position) {
    console.log('Position:', state.position);
    console.log('Position Token A Vault:', state.positionTokenAVault);
    console.log('Position Token B Vault:', state.positionTokenBVault);
  }
  console.log('Protocol Authority:', state.protocolAuthority);
  console.log('User Main Account:', state.userMainAccount);
  
  console.log('\n✅ Balance check complete!');
}

if (require.main === module) {
  checkBalances().catch(console.error);
}
