// scripts/utils/pyth-devnet.ts
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, SystemProgram, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { loadState, loadUserKeypair } from './setup';

// Devnet configuration
const DEVNET_RPC = "https://api.devnet.solana.com";

// Price feed IDs for Devnet
// Source: https://pyth.network/developers/price-feed-ids#solana-devnet
const DEVNET_FEEDS = {
  'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'USDC/USD': '0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722',
  'BTC/USD': '0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b',
  'ETH/USD': '0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6',
};

// Mock program IDs for external protocols
const MOCK_METEORA_PROGRAM = new PublicKey("METoYfK9KhJHnec5HL8kTybWGmTEJvnqwNYWuWtFGHH");
const MOCK_KAMINO_PROGRAM = new PublicKey("KAMiNoXmYHN3hiPvvufVqwRPEPAy6Jh8H7F7SEKcfGH");  
const MOCK_JUPITER_PROGRAM = new PublicKey("JUPyTerVGraWPqKUN5g8STQTQbZvCEPfbZFpRFGHHHH");

export class PythDevnet {
  private hermesClient: HermesClient;
  private pythSolanaReceiver: PythSolanaReceiver;
  private connection: Connection;
  private wallet: anchor.Wallet;
  private program: Program<CapitalReallocator>;
  
  constructor(wallet: anchor.Wallet) {
    const cluster = process.env.ANCHOR_PROVIDER_URL
    // Always use devnet
    this.connection = new Connection(cluster, 'confirmed');
    this.wallet = wallet;
    
    // Setup provider for devnet
    const provider = new anchor.AnchorProvider(
      this.connection,
      wallet,
      { commitment: 'confirmed' }
    );
    anchor.setProvider(provider);
    // const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    this.program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
    
    // Initialize Hermes client (fetches prices)
    this.hermesClient = new HermesClient(
      "https://hermes.pyth.network/",
      {}
    );
    
    // Initialize Pyth Solana receiver (posts prices to chain)
    this.pythSolanaReceiver = new PythSolanaReceiver({
      connection: this.connection,
      wallet,
    });
  }
  
  // Fetch and display current price
  async fetchPrice(symbol: string = 'SOL/USD'): Promise<{
    price: number;
    confidence: number;
    timestamp: Date;
  }> {
    console.log(`\n📊 Fetching ${symbol} price from Pyth...`);
    
    const feedId = DEVNET_FEEDS[symbol];
    if (!feedId) {
      throw new Error(`Unknown price feed: ${symbol}`);
    }
    
    const priceUpdate = await this.hermesClient.getLatestPriceUpdates(
      [feedId],
      { encoding: "base64" }
    );
    
    const priceInfo = priceUpdate.parsed?.[0];
    if (!priceInfo) {
      throw new Error('No price data available');
    }
    
    const price = parseFloat(priceInfo.price.price);
    const expo = priceInfo.price.expo;
    const displayPrice = price * Math.pow(10, expo);
    const displayConfidence = parseFloat(priceInfo.price.conf) * Math.pow(10, expo);
    const timestamp = new Date(priceInfo.price.publish_time * 1000);
    
    console.log(`Price: $${displayPrice.toFixed(2)} ± $${displayConfidence.toFixed(2)}`);
    console.log(`Updated: ${timestamp.toISOString()}`);
    
    return {
      price: displayPrice,
      confidence: displayConfidence,
      timestamp
    };
  }
  
  // Check position status with real Pyth price
  async checkStatus(positionPubkey: PublicKey): Promise<void> {
    console.log('\n🔍 Checking position status with Pyth...');
    
    // Get position state
    const position = await this.program.account.position.fetch(positionPubkey);
    const rangeMin = position.lpRangeMin.toNumber() / 1e6;
    const rangeMax = position.lpRangeMax.toNumber() / 1e6;
    
    console.log(`Position range: $${rangeMin} - $${rangeMax}`);
    console.log(`Paused: ${position.pauseFlag ? 'Yes ⏸️' : 'No ▶️'}`);
    
    // Fetch current price
    const { price } = await this.fetchPrice('SOL/USD');
    
    // Check if price is in range
    const inRange = price >= rangeMin && price <= rangeMax;
    console.log(`Price in range: ${inRange ? '✅ Yes' : '❌ No'}`);
    
    // Fetch price update data
    const priceUpdateData = await this.hermesClient.getLatestPriceUpdates(
      [DEVNET_FEEDS['SOL/USD']],
      { encoding: "base64" }
    );
    
    // Build transaction
    const transactionBuilder = this.pythSolanaReceiver.newTransactionBuilder({
      closeUpdateAccounts: true,
    });
    
    await transactionBuilder.addPostPriceUpdates(priceUpdateData.binary.data);
    
    await transactionBuilder.addPriceConsumerInstructions(
      async (getPriceUpdateAccount: (priceFeedId: string) => PublicKey) => {
        const priceUpdateAccount = getPriceUpdateAccount(DEVNET_FEEDS['SOL/USD']);
        
        const instruction = await this.program.methods
          .checkPositionStatus()
          .accountsPartial({
            position: positionPubkey,
            priceUpdate: priceUpdateAccount,
          })
          .instruction();
        
        return [{
          instruction,
          signers: [],
        }];
      }
    );
    
    // Send transaction
    const txs = await transactionBuilder.buildVersionedTransactions({
      computeUnitPriceMicroLamports: 50000,
    });
    
    const signatures = await this.pythSolanaReceiver.provider.sendAll(
      txs,
      { skipPreflight: true }
    );
    
    console.log('✅ Status check complete');
    console.log('🔗 View on explorer:', `https://explorer.solana.com/tx/${signatures[0]}?cluster=devnet`);
  }
  
  // Rebalance position with real Pyth price
  async rebalance(positionPubkey: PublicKey): Promise<void> {
    console.log('\n🔄 Rebalancing position with Pyth...');
    
    // Get position state
    const position = await this.program.account.position.fetch(positionPubkey);
    
    if (position.pauseFlag) {
      console.log('⏸️ Position is paused. Resume it first.');
      return;
    }
    
    // Show current allocation
    console.log('\nCurrent allocation:');
    console.log(`  Vault: A=${(position.tokenAVaultBalance.toNumber() / 1e6).toFixed(2)}, B=${(position.tokenBVaultBalance.toNumber() / 1e9).toFixed(4)}`);
    console.log(`  LP: A=${(position.tokenAInLp.toNumber() / 1e6).toFixed(2)}, B=${(position.tokenBInLp.toNumber() / 1e9).toFixed(4)}`);
    console.log(`  Lending: A=${(position.tokenAInLending.toNumber() / 1e6).toFixed(2)}, B=${(position.tokenBInLending.toNumber() / 1e9).toFixed(4)}`);
    
    // // Fetch current price
    // const { price } = await this.fetchPrice('SOL/USD');
    
    // const rangeMin = position.lpRangeMin.toNumber() / 1e6;
    // const rangeMax = position.lpRangeMax.toNumber() / 1e6;
    // const inRange = price >= rangeMin && price <= rangeMax;
    
    // // Check if rebalance is needed
    // const hasLP = position.tokenAInLp.toNumber() > 0 || position.tokenBInLp.toNumber() > 0;
    // const hasLending = position.tokenAInLending.toNumber() > 0 || position.tokenBInLending.toNumber() > 0;
    // const hasIdle = position.tokenAVaultBalance.toNumber() > 0 || position.tokenBVaultBalance.toNumber() > 0;
    
    // const needsRebalance = (inRange && hasLending) || (!inRange && hasLP) || hasIdle;
    
    // console.log('\nRebalance analysis:');
    // console.log(`  Price: $${price.toFixed(2)} (Range: $${rangeMin}-$${rangeMax})`);
    // console.log(`  In range: ${inRange}`);
    // console.log(`  Needs rebalance: ${needsRebalance}`);
    
    // if (!needsRebalance) {
    //   console.log('✅ Position is already optimally allocated');
    //   return;
    // }
    
    // Fetch price update data
    const priceUpdateData = await this.hermesClient.getLatestPriceUpdates(
      [DEVNET_FEEDS['SOL/USD']],
      { encoding: "base64" }
    );
    
    // Build transaction
    const transactionBuilder = this.pythSolanaReceiver.newTransactionBuilder({
      closeUpdateAccounts: false,
    });
    
    await transactionBuilder.addPostPriceUpdates(priceUpdateData.binary.data);
    
    await transactionBuilder.addPriceConsumerInstructions(
      async (getPriceUpdateAccount: (priceFeedId: string) => PublicKey) => {
        const priceUpdateAccount = getPriceUpdateAccount(DEVNET_FEEDS['SOL/USD']);
        
        const instruction = await this.program.methods
          .rebalancePosition()
          .accountsPartial({
            position: positionPubkey,
            priceUpdate: priceUpdateAccount,
            meteoraProgram: MOCK_METEORA_PROGRAM,
            kaminoProgram: MOCK_KAMINO_PROGRAM,
            jupiterProgram: MOCK_JUPITER_PROGRAM,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
        
        return [{
          instruction,
          signers: [],
        }];
      }
    );
    
    // Send transaction
    const txs = await transactionBuilder.buildVersionedTransactions({
      computeUnitPriceMicroLamports: 50000,
    });
    
    const signatures = await this.pythSolanaReceiver.provider.sendAll(
      txs,
      { skipPreflight: true }
    );
    
    console.log('✅ Rebalance complete');
    console.log('🔗 View on explorer:', `https://explorer.solana.com/tx/${signatures[0]}?cluster=devnet`);
    
    // Show new allocation
    const updatedPosition = await this.program.account.position.fetch(positionPubkey);
    console.log('\nNew allocation:');
    console.log(`  Vault: A=${(updatedPosition.tokenAVaultBalance.toNumber() / 1e6).toFixed(2)}, B=${(updatedPosition.tokenBVaultBalance.toNumber() / 1e9).toFixed(4)}`);
    console.log(`  LP: A=${(updatedPosition.tokenAInLp.toNumber() / 1e6).toFixed(2)}, B=${(updatedPosition.tokenBInLp.toNumber() / 1e9).toFixed(4)}`);
    console.log(`  Lending: A=${(updatedPosition.tokenAInLending.toNumber() / 1e6).toFixed(2)}, B=${(updatedPosition.tokenBInLending.toNumber() / 1e9).toFixed(4)}`);
    console.log(`  Total rebalances: ${updatedPosition.totalRebalances.toString()}`);
  }
  
  // Monitor position for rebalance opportunities
  async monitor(positionPubkey: PublicKey, duration: number = 60): Promise<void> {
    console.log(`\n👁️ Monitoring position for ${duration} seconds...`);
    
    const position = await this.program.account.position.fetch(positionPubkey);
    const rangeMin = position.lpRangeMin.toNumber() / 1e6;
    const rangeMax = position.lpRangeMax.toNumber() / 1e6;
    
    console.log(`Position range: $${rangeMin} - $${rangeMax}`);
    
    const startTime = Date.now();
    let checkCount = 0;
    
    const checkPrice = async () => {
      checkCount++;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      console.log(`\n--- Check ${checkCount} (${elapsed}s) ---`);
      
      // try {
      //   const { price } = await this.fetchPrice('SOL/USD');
      //   const inRange = price >= rangeMin && price <= rangeMax;
        
      //   const hasLP = position.tokenAInLp.toNumber() > 0 || position.tokenBInLp.toNumber() > 0;
      //   const hasLending = position.tokenAInLending.toNumber() > 0 || position.tokenBInLending.toNumber() > 0;
        
      //   let action = 'No action needed';
      //   if (inRange && hasLending) {
      //     action = '⚠️ Should move from lending to LP';
      //   } else if (!inRange && hasLP) {
      //     action = '⚠️ Should move from LP to lending';
      //   }
        
      //   console.log(`Price: $${price.toFixed(2)} | In range: ${inRange ? '✅' : '❌'} | ${action}`);
        
      // } catch (error) {
      //   console.log('Error fetching price:', error.message);
      // }
      this.rebalance(positionPubkey)
      
      if (elapsed < duration) {
        setTimeout(checkPrice, 10000); // Check every 10 seconds
      } else {
        console.log('\n✅ Monitoring complete');
      }
    };
    
    await checkPrice();
  }
}

// Main execution
async function main() {
  console.log('🚀 Pyth Devnet Testing\n');
  
  // Check we're on devnet
  const url = process.env.ANCHOR_PROVIDER_URL || '';
  // if (!url.includes('devnet')) {
  //   console.log('⚠️  Warning: Not configured for devnet');
  //   console.log('Run: export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com');
  // }
  
  const state = loadState();
  const user = loadUserKeypair();
  
  if (!state.position) {
    console.log('❌ No position found. Create a position first:');
    console.log('   yarn create-position');
    return;
  }
  
  // Create wallet from user keypair
  const wallet = new anchor.Wallet(user);
  
  // Initialize Pyth devnet client
  const pyth = new PythDevnet(wallet);
  
  const position = new PublicKey(state.position);
  const command = process.argv[2] || 'price';
  
  try {
    switch (command) {
      case 'price':
        await pyth.fetchPrice('SOL/USD');
        break;
        
      case 'check':
        await pyth.checkStatus(position);
        break;
        
      case 'rebalance':
        await pyth.rebalance(position);
        break;
        
      case 'monitor':
        const duration = parseInt(process.argv[3]) || 60;
        await pyth.monitor(position, duration);
        break;
        
      default:
        console.log('Usage: yarn pyth-devnet [command]');
        console.log('Commands:');
        console.log('  price     - Fetch current SOL/USD price');
        console.log('  check     - Check position status');
        console.log('  rebalance - Execute rebalancing');
        console.log('  monitor   - Monitor price (optional: duration in seconds)');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
