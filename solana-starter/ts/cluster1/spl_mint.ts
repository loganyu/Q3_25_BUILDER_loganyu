import { Keypair, PublicKey, Connection, Commitment } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import wallet from "../turbin3-wallet.json"

// Import our keypair from the wallet file
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

const token_decimals = 1_000_000;

// Mint address
const mint = new PublicKey("AAvXWjh8BZVB4KMwzgk8VrkmbZ8zXL5eEpS778hyArJA");

(async () => {
    try {
        // Create an ATA
        const ata = await getOrCreateAssociatedTokenAccount(
            connection,
            keypair,
            mint,
            keypair.publicKey
        )
        console.log(`Your ata is: ${ata.address.toBase58()}`);
        // Your ata is: DXozJjr6zsDmWoJ73yp7EJebTjPG2GfeH4DgFsVCNZD

        // Mint to ATA
        const mintTx = await mintTo(
            connection,
            keypair,
            mint,
            ata.address,
            keypair.publicKey,
            100 * token_decimals
        )
        console.log(`Your mint txid: ${mintTx}`);

        // Your mint txid: 63sZvB4zQRVbWud4f7dRbe4nJP7Frvo5ukeztadbwNRVc5x7invxMpzDYcUB2E3J3KZ7jsYHzYt1pmKxopUJ3Rje
    } catch(error) {
        console.log(`Oops, something went wrong: ${error}`)
    }
})()
