import { Commitment, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import wallet from "../turbin3-wallet.json"
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";

// We're going to import our keypair from the wallet file
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

// Mint address
const mint = new PublicKey("AAvXWjh8BZVB4KMwzgk8VrkmbZ8zXL5eEpS778hyArJA");

// Recipient address
const to = new PublicKey("4jfWkSXpBtZUc1eybj7RKCqmrvdaznMPFY3aFEA7Ma6N");

const token_decimals = 1_000_000;

(async () => {
    try {
        // Get the token account of the fromWallet address, and if it does not exist, create it
        const ata_from = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, keypair.publicKey)
        // Get the token account of the toWallet address, and if it does not exist, create it
        const ata_to = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, to)
        // Transfer the new token to the "toTokenAccount" we just created
        const tx = await transfer(connection, keypair, ata_from.address, ata_to.address, keypair.publicKey, 10 * token_decimals)
        console.log('transfer tx:', tx)
        // transfer tx: 5pN2sJCQBANXQrFzj6h4t1JBtDHmCUB8Eb5CooofD7zspD5RwuBYeAjgQftUmx2Pb4Y8NrrpZJdwdjiUhofX5rH
    } catch(e) {
        console.error(`Oops, something went wrong: ${e}`)
    }
})();