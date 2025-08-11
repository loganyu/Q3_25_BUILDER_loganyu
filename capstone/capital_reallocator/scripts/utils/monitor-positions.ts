// scripts/utils/monitor-positions.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';
import { HermesClient } from "@pythnetwork/hermes-client";

interface PositionMetrics {
  positionId: string;
  owner: string;
  totalValueUSD: number;
  allocationLP: number;
  allocationLending: number;
  allocationIdle: number;
  inRange: boolean;
  currentPrice: number;
  rangeMin: number;
  rangeMax: number;
  totalRebalances: number;
  lastRebalancePrice: number;
  isPaused: boolean;
  createdAt: Date;
}

interface ProtocolMetrics {
  totalPositions: number;
  totalValueLocked: number;
  totalFeesCollected: number;
  activePositions: number;
  pausedPositions: number;
  averagePositionSize: number;
  protocolFeeBps: number;
}

class PositionMonitor {
  private program: Program<CapitalReallocator>;
  private connection: anchor.web3.Connection;
  private hermesClient: HermesClient;
  
  constructor() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    this.program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
    this.connection = provider.connection;
    
    // Initialize Hermes client for price data
    this.hermesClient = new HermesClient("https://hermes.pyth.network/", {});
  }
  
  async getCurrentPrice(): Promise<{ price: number; confidence: number }> {
    try {
      const SOL_USD_FEED_ID = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
      
      const priceUpdate = await this.hermesClient.getLatestPriceUpdates(
        [SOL_USD_FEED_ID],
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
      
      return {
        price: displayPrice,
        confidence: displayConfidence
      };
    } catch (error) {
      console.warn('Failed to fetch real price, using mock data');
      return { price: 150.0, confidence: 1.0 }; // Mock price
    }
  }
  
  async getPositionMetrics(positionPubkey: PublicKey): Promise<PositionMetrics | null> {
    try {
      const position = await this.program.account.position.fetch(positionPubkey);
      
      // Calculate total values
      const tokenATotal = position.tokenAVaultBalance.toNumber() + 
                         position.tokenAInLp.toNumber() + 
                         position.tokenAInLending.toNumber();
      const tokenBTotal = position.tokenBVaultBalance.toNumber() + 
                         position.tokenBInLp.toNumber() + 
                         position.tokenBInLending.toNumber();
      
      // Get current price
      const { price: currentPrice } = await this.getCurrentPrice();
      
      // Calculate USD values (assuming Token A is USD-pegged)
      const tokenAValueUSD = tokenATotal / 1e6; // 6 decimals
      const tokenBValueUSD = (tokenBTotal / 1e9) * currentPrice; // 9 decimals * price
      const totalValueUSD = tokenAValueUSD + tokenBValueUSD;
      
      // Calculate allocations as percentages
      const lpValueA = position.tokenAInLp.toNumber() / 1e6;
      const lpValueB = (position.tokenBInLp.toNumber() / 1e9) * currentPrice;
      const allocationLP = totalValueUSD > 0 ? ((lpValueA + lpValueB) / totalValueUSD) * 100 : 0;
      
      const lendingValueA = position.tokenAInLending.toNumber() / 1e6;
      const lendingValueB = (position.tokenBInLending.toNumber() / 1e9) * currentPrice;
      const allocationLending = totalValueUSD > 0 ? ((lendingValueA + lendingValueB) / totalValueUSD) * 100 : 0;
      
      const idleValueA = position.tokenAVaultBalance.toNumber() / 1e6;
      const idleValueB = (position.tokenBVaultBalance.toNumber() / 1e9) * currentPrice;
      const allocationIdle = totalValueUSD > 0 ? ((idleValueA + idleValueB) / totalValueUSD) * 100 : 0;
      
      // Check if price is in range
      const rangeMin = position.lpRangeMin.toNumber() / 1e6;
      const rangeMax = position.lpRangeMax.toNumber() / 1e6;
      const inRange = currentPrice >= rangeMin && currentPrice <= rangeMax;
      
      return {
        positionId: position.positionId.toString(),
        owner: position.owner.toString(),
        totalValueUSD,
        allocationLP,
        allocationLending,
        allocationIdle,
        inRange,
        currentPrice,
        rangeMin,
        rangeMax,
        totalRebalances: position.totalRebalances.toNumber(),
        lastRebalancePrice: position.lastRebalancePrice.toNumber() / 1e6,
        isPaused: position.pauseFlag,
        createdAt: new Date(position.createdAt.toNumber() * 1000)
      };
    } catch (error) {
      console.error(`Failed to fetch position ${positionPubkey.toString()}:`, error.message);
      return null;
    }
  }
  
  async getProtocolMetrics(): Promise<ProtocolMetrics | null> {
    try {
      const state = loadState();
      const protocolState = await this.program.account.protocolAuthority.fetch(
        new PublicKey(state.protocolAuthority)
      );
      
      // Get all user accounts to find positions
      const userAccounts = await this.connection.getProgramAccounts(
        this.program.programId,
        {
          filters: [
            { dataSize: 8 + 32 + 8 + 8 + 1 }, // UserMainAccount size
          ]
        }
      );
      
      let totalPositions = 0;
      let activePositions = 0;
      let pausedPositions = 0;
      let totalValueLocked = 0;
      
      // This is a simplified version - in production you'd scan all positions
      // For demo purposes, we'll use the current position if it exists
      if (state.position) {
        const metrics = await this.getPositionMetrics(new PublicKey(state.position));
        if (metrics) {
          totalPositions = 1;
          activePositions = metrics.isPaused ? 0 : 1;
          pausedPositions = metrics.isPaused ? 1 : 0;
          totalValueLocked = metrics.totalValueUSD;
        }
      }
      
      return {
        totalPositions: protocolState.totalPositions.toNumber(),
        totalValueLocked,
        totalFeesCollected: 0, // Would calculate from fee recipient accounts
        activePositions,
        pausedPositions,
        averagePositionSize: totalPositions > 0 ? totalValueLocked / totalPositions : 0,
        protocolFeeBps: protocolState.protocolFeeBps
      };
    } catch (error) {
      console.error('Failed to fetch protocol metrics:', error.message);
      return null;
    }
  }
  
  async displayPositionDashboard(): Promise<void> {
    console.log('📊 Capital Reallocator - Position Monitor');
    console.log('==========================================\n');
    
    const isDevnet = this.connection.rpcEndpoint.includes('devnet');
    console.log(`🌐 Network: ${isDevnet ? 'DEVNET' : 'LOCAL'}`);
    console.log(`🔗 RPC: ${this.connection.rpcEndpoint}`);
    
    // Get current price
    const { price: currentPrice, confidence } = await this.getCurrentPrice();
    console.log(`💰 Current SOL/USD: $${currentPrice.toFixed(2)} ± $${confidence.toFixed(2)}`);
    console.log(`🕒 Price Age: ${new Date().toISOString()}`);
    
    // Protocol Overview
    console.log('\n🏛️  Protocol Overview');
    console.log('─'.repeat(40));
    
    const protocolMetrics = await this.getProtocolMetrics();
    if (protocolMetrics) {
      console.log(`Total Positions: ${protocolMetrics.totalPositions}`);
      console.log(`Active Positions: ${protocolMetrics.activePositions}`);
      console.log(`Paused Positions: ${protocolMetrics.pausedPositions}`);
      console.log(`Total Value Locked: $${protocolMetrics.totalValueLocked.toFixed(2)}`);
      console.log(`Average Position Size: $${protocolMetrics.averagePositionSize.toFixed(2)}`);
      console.log(`Protocol Fee: ${protocolMetrics.protocolFeeBps} bps (${(protocolMetrics.protocolFeeBps / 100).toFixed(2)}%)`);
    } else {
      console.log('❌ Failed to load protocol metrics');
    }
    
    // Position Details
    console.log('\n📊 Position Details');
    console.log('─'.repeat(40));
    
    const state = loadState();
    if (state.position) {
      const positionMetrics = await this.getPositionMetrics(new PublicKey(state.position));
      if (positionMetrics) {
        console.log(`Position ID: ${positionMetrics.positionId}`);
        console.log(`Owner: ${positionMetrics.owner.slice(0, 8)}...${positionMetrics.owner.slice(-8)}`);
        console.log(`Created: ${positionMetrics.createdAt.toLocaleDateString()}`);
        console.log(`Status: ${positionMetrics.isPaused ? '⏸️  PAUSED' : '▶️  ACTIVE'}`);
        
        console.log('\n💼 Value Breakdown:');
        console.log(`  Total Value: $${positionMetrics.totalValueUSD.toFixed(2)}`);
        console.log(`  LP Allocation: ${positionMetrics.allocationLP.toFixed(1)}%`);
        console.log(`  Lending Allocation: ${positionMetrics.allocationLending.toFixed(1)}%`);
        console.log(`  Idle Funds: ${positionMetrics.allocationIdle.toFixed(1)}%`);
        
        console.log('\n🎯 Price Strategy:');
        console.log(`  Range: $${positionMetrics.rangeMin.toFixed(2)} - $${positionMetrics.rangeMax.toFixed(2)}`);
        console.log(`  Current Price: $${positionMetrics.currentPrice.toFixed(2)}`);
        console.log(`  In Range: ${positionMetrics.inRange ? '✅ YES' : '❌ NO'}`);
        
        console.log('\n🔄 Rebalancing History:');
        console.log(`  Total Rebalances: ${positionMetrics.totalRebalances}`);
        console.log(`  Last Rebalance Price: $${positionMetrics.lastRebalancePrice.toFixed(2)}`);
        
        // Strategy Recommendation
        console.log('\n💡 Strategy Analysis:');
        if (positionMetrics.inRange && positionMetrics.allocationLending > 0) {
          console.log('  🔄 Should move from lending to LP (price in range)');
        } else if (!positionMetrics.inRange && positionMetrics.allocationLP > 0) {
          console.log('  🔄 Should move from LP to lending (price out of range)');
        } else if (positionMetrics.allocationIdle > 10) {
          console.log(`  📈 Should deploy ${positionMetrics.allocationIdle.toFixed(1)}% idle funds`);
        } else {
          console.log('  ✅ Position is optimally allocated');
        }
      } else {
        console.log('❌ Failed to load position metrics');
      }
    } else {
      console.log('📝 No position found. Create one with: yarn create-position');
    }
    
    // Account Health
    console.log('\n🏥 Account Health');
    console.log('─'.repeat(40));
    
    const user = loadUserKeypair();
    const solBalance = await this.connection.getBalance(user.publicKey);
    console.log(`SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    
    if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
      console.log('⚠️  Low SOL balance for transactions');
    } else {
      console.log('✅ Sufficient SOL for transactions');
    }
    
    // Token Balances
    if (state.userTokenA && state.userTokenB) {
      try {
        const tokenAAccount = await getAccount(this.connection, new PublicKey(state.userTokenA));
        const tokenBAccount = await getAccount(this.connection, new PublicKey(state.userTokenB));
        
        console.log(`Token A Balance: ${(Number(tokenAAccount.amount) / 1e6).toFixed(6)}`);
        console.log(`Token B Balance: ${(Number(tokenBAccount.amount) / 1e9).toFixed(9)}`);
      } catch (error) {
        console.log('⚠️  Could not fetch token balances');
      }
    }
    
    // Quick Actions
    console.log('\n🚀 Quick Actions');
    console.log('─'.repeat(40));
    console.log('yarn pyth:check          - Check with real price');
    console.log('yarn pyth:rebalance      - Execute rebalancing');
    console.log('yarn pyth:monitor 60     - Monitor for 60 seconds');
    console.log('yarn balances            - Detailed balance view');
    console.log('yarn deposit 100 1       - Deposit more funds');
    console.log('yarn withdraw 25         - Withdraw 25%');
  }
  
  async startContinuousMonitoring(intervalSeconds: number = 30): Promise<void> {
    console.log(`👁️  Starting continuous monitoring (${intervalSeconds}s intervals)`);
    console.log('Press Ctrl+C to stop\n');
    
    let updateCount = 0;
    
    const updateInterval = setInterval(async () => {
      updateCount++;
      
      // Clear screen (optional)
      if (process.stdout.isTTY) {
        console.clear();
      }
      
      console.log(`🔄 Update #${updateCount} - ${new Date().toLocaleTimeString()}\n`);
      
      await this.displayPositionDashboard();
      
      console.log(`\n⏰ Next update in ${intervalSeconds} seconds...`);
      
    }, intervalSeconds * 1000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(updateInterval);
      console.log('\n\n👋 Monitoring stopped');
      process.exit(0);
    });
    
    // Initial display
    await this.displayPositionDashboard();
    console.log(`\n⏰ Next update in ${intervalSeconds} seconds...`);
  }
}

async function main() {
  const monitor = new PositionMonitor();
  
  const command = process.argv[2] || 'dashboard';
  const interval = parseInt(process.argv[3]) || 30;
  
  try {
    switch (command) {
      case 'dashboard':
      case 'status':
        await monitor.displayPositionDashboard();
        break;
        
      case 'watch':
      case 'monitor':
        await monitor.startContinuousMonitoring(interval);
        break;
        
      default:
        console.log('Usage: yarn monitor [command] [interval]');
        console.log('Commands:');
        console.log('  dashboard  - Show current status (default)');
        console.log('  watch      - Continuous monitoring');
        console.log('  monitor    - Same as watch');
        console.log('\nExamples:');
        console.log('  yarn monitor dashboard');
        console.log('  yarn monitor watch 60');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
