// scripts/utils/init-protocol.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapitalReallocator } from "../../target/types/capital_reallocator";
import { SystemProgram, Keypair } from "@solana/web3.js";
import { createAccount } from "@solana/spl-token";
import { loadState, loadUserKeypair } from './setup';

async function initializeProtocol() {
  console.log('🚀 Initializing protocol...');
  
  // Load state and setup
  const state = loadState();
  const user = loadUserKeypair();
  
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CapitalReallocator as Program<CapitalReallocator>;
  
  // Create fee recipient
  const feeRecipient = Keypair.generate();
  console.log('💰 Fee recipient:', feeRecipient.publicKey.toString());
  
  // Airdrop SOL to fee recipient
  await provider.connection.requestAirdrop(feeRecipient.publicKey, anchor.web3.LAMPORTS_PER_SOL);
  
  // Create fee recipient token accounts
  const feeTokenA = await createAccount(
    provider.connection,
    user, // payer
    new anchor.web3.PublicKey(state.tokenAMint),
    feeRecipient.publicKey
  );
  
  const feeTokenB = await createAccount(
    provider.connection,
    user, // payer  
    new anchor.web3.PublicKey(state.tokenBMint),
    feeRecipient.publicKey
  );
  
  console.log('💼 Fee Token A account:', feeTokenA.toString());
  console.log('💼 Fee Token B account:', feeTokenB.toString());
  
  // Initialize protocol with 0.5% fee
  const feeBps = 50; // 0.5%
  
  const tx = await program.methods
    .initializeProtocol(feeBps)
    .accountsPartial({
      protocolAuthority: new anchor.web3.PublicKey(state.protocolAuthority),
      feeRecipient: feeRecipient.publicKey,
      payer: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('📝 Transaction signature:', tx);
  console.log('🔗 View on explorer:', getExplorerUrl(tx));

  // Verify protocol state
  const protocolState = await program.account.protocolAuthority.fetch(
    new anchor.web3.PublicKey(state.protocolAuthority)
  );
  
  console.log('\n✅ Protocol initialized successfully!');
  console.log('📊 Protocol fee:', protocolState.protocolFeeBps, 'bps');
  console.log('💰 Fee recipient:', protocolState.feeRecipient.toString());
  console.log('📈 Total positions:', protocolState.totalPositions.toString());
  
  // Update state file with fee recipient info
  const updatedState = {
    ...state,
    feeRecipient: feeRecipient.publicKey.toString(),
    feeRecipientSecretKey: JSON.stringify(Array.from(feeRecipient.secretKey)),
    feeTokenA: feeTokenA.toString(),
    feeTokenB: feeTokenB.toString(),
  };
  
  require('fs').writeFileSync('./scripts/state.json', JSON.stringify(updatedState, null, 2));
  console.log('💾 Updated state file');
  
  console.log('\n🎯 Next step: npx ts-node scripts/utils/init-user.ts');
}

function getExplorerUrl(signature: string): string {
  const cluster = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ? 'devnet' : 'localnet';
  if (cluster === 'devnet') {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `Local transaction: ${signature}`;
}

if (require.main === module) {
  initializeProtocol().catch(console.error);
}
