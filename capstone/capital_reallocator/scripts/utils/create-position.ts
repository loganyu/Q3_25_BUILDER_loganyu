// scripts/utils/create-position.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { SystemProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { BN } from "bn.js";
import { loadState, loadUserKeypair } from './setup';

async function createPosition() {
  console.log('📊 Creating position...');

  // Get command line arguments or use defaults
  const args = process.argv.slice(2);
  const rangeMinUSD = args[0] ? parseInt(args[0]) : 150; // Default: 150
  const rangeMaxUSD = args[1] ? parseInt(args[1]) : 160;    // Default: 160
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  // Position parameters
  const positionId = new BN(1);
  const lpRangeMin = new BN(rangeMinUSD * 10**6); 
  const lpRangeMax = new BN(rangeMaxUSD * 10**6); 
  
  console.log('🔢 Position ID:', positionId.toString());
  console.log(`📈 LP Range: $${rangeMinUSD}-$${rangeMaxUSD}`);
  
  // Derive position PDA
  const [position] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      user.publicKey.toBuffer(),
      positionId.toArrayLike(Buffer, "le", 8)
    ],
    program.programId
  );
  
  // Derive position token vaults
  const positionTokenAVault = await getAssociatedTokenAddress(
    new PublicKey(state.tokenAMint),
    position,
    true // allowOwnerOffCurve
  );
  
  const positionTokenBVault = await getAssociatedTokenAddress(
    new PublicKey(state.tokenBMint),
    position,
    true
  );
  
  console.log('📋 Position PDA:', position.toString());
  console.log('💼 Token A vault:', positionTokenAVault.toString());
  console.log('💼 Token B vault:', positionTokenBVault.toString());
  
  const tx = await program.methods
    .createPosition(positionId, lpRangeMin, lpRangeMax)
    .accountsPartial({
      position,
      userMainAccount: new PublicKey(state.userMainAccount),
      protocolAuthority: new PublicKey(state.protocolAuthority),
      tokenAMint: new PublicKey(state.tokenAMint),
      tokenBMint: new PublicKey(state.tokenBMint),
      positionTokenAVault,
      positionTokenBVault,
      owner: user.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  console.log('📝 Transaction signature:', tx);
  console.log('🔗 View on explorer:', getExplorerUrl(tx));

  // Verify position was created
  const positionState = await program.account.position.fetch(position);
  
  console.log('\n✅ Position created successfully!');
  console.log('👤 Owner:', positionState.owner.toString());
  console.log('🔢 Position ID:', positionState.positionId.toString());
  console.log('💰 Token A mint:', positionState.tokenAMint.toString());
  console.log('💰 Token B mint:', positionState.tokenBMint.toString());
  console.log('📈 LP Range Min:', (positionState.lpRangeMin.toNumber() / 10**6).toFixed(2));
  console.log('📈 LP Range Max:', (positionState.lpRangeMax.toNumber() / 10**6).toFixed(2));
  console.log('⏸️  Paused:', positionState.pauseFlag);
  console.log('📅 Created at:', new Date(positionState.createdAt.toNumber() * 1000).toISOString());
  
  // Verify vault balances
  console.log('\n💼 Vault Balances:');
  console.log('Token A vault balance:', positionState.tokenAVaultBalance.toString());
  console.log('Token B vault balance:', positionState.tokenBVaultBalance.toString());
  console.log('Token A in LP:', positionState.tokenAInLp.toString());
  console.log('Token B in LP:', positionState.tokenBInLp.toString());
  console.log('Token A in lending:', positionState.tokenAInLending.toString());
  console.log('Token B in lending:', positionState.tokenBInLending.toString());
  
  // Update state file with position info
  const updatedState = {
    ...state,
    position: position.toString(),
    positionId: positionId.toString(),
    positionTokenAVault: positionTokenAVault.toString(),
    positionTokenBVault: positionTokenBVault.toString(),
  };
  
  require('fs').writeFileSync('./scripts/state.json', JSON.stringify(updatedState, null, 2));
  console.log('💾 Updated state file');
  
  console.log('\n🎯 Next step: npx ts-node scripts/utils/deposit.ts');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  createPosition().catch(console.error);
}
