import { Transaction, SystemProgram, Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, PublicKey } from "@solana/web3.js"
import wallet from "./dev-wallet.json"

// Import our dev wallet keypair from the wallet file
const from = Keypair.fromSecretKey(new Uint8Array(wallet));
// Define our Turbin3 public key
const to = new PublicKey("HdkedsbkkJFTLmKnm8uHt27X4RXMrQS4n91qU7zWR1W8");

// Create a Solana devnet connection
const connection = new Connection("https://api.devnet.solana.com");

// Now we're going to create a transaction using @solana/web3.js to transfer 0.1 SOL
// from our dev wallet to our Turbin3 wallet address on the Solana devenet. Here's how
// we do that:
// (async () => {
//   try {
//     const transaction = new Transaction().add(
//       SystemProgram.transfer({fromPubkey: from.publicKey,toPubkey: to,lamports: LAMPORTS_PER_SOL / 100,})
//     );
//     transaction.recentBlockhash = (
//       await connection.getLatestBlockhash('confirmed')
//     ).blockhash;

//     transaction.feePayer = from.publicKey;
//     // Sign transaction, broadcast, and confirm
//     const signature = await sendAndConfirmTransaction(connection,transaction,[from]);
//     console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
//   } catch (e) {
//     console.error(`Oops, something went wrong: ${e}`);
//   }
// })();

(async () => {
  try {
    // Get balance of dev wallet
    const balance = await connection.getBalance(from.publicKey)
    // Create a test transaction to calculate fees
    const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: balance,
    })
    );
    transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    transaction.feePayer = from.publicKey;
    // Calculate exact fee rate to transfer entire SOL amount out of account minus fees
    const fee = (await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')).value || 0;
    // Remove our transfer instruction to replace it
    transaction.instructions.pop();
    // Now add the instruction back with correct amount of lamports
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: to,
        lamports: balance - fee,
      })
    );
    // Sign transaction, broadcast, and confirm
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [from]
    );
    console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${signature}?cluster=devnet`)
  } catch(e) {
    console.error(`Oops, something went wrong: ${e}`)
  }
})();