import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { createSignerFromKeypair, signerIdentity, generateSigner, percentAmount } from "@metaplex-foundation/umi"
import { createNft, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

import wallet from "../turbin3-wallet.json"
import base58 from "bs58";

const RPC_ENDPOINT = "https://api.devnet.solana.com";
const umi = createUmi(RPC_ENDPOINT);

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const myKeypairSigner = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(myKeypairSigner));
umi.use(mplTokenMetadata())

const mint = generateSigner(umi);

(async () => {
    let tx = await createNft(umi, {
        mint,
        name: "Logan Rug",
        symbol: "LOGRUG",
        uri: "https://devnet.irys.xyz/FYa891o4UZffRCXaPieUABUWBWdauPdhJ4aDfSJe94uR",
        sellerFeeBasisPoints: percentAmount(5),
    })
    let result = await tx.sendAndConfirm(umi);
    const signature = base58.encode(result.signature);
    
    console.log(`Succesfully Minted! Check out your TX here:\nhttps://explorer.solana.com/tx/${signature}?cluster=devnet`)
    /*
    Succesfully Minted! Check out your TX here:
    https://explorer.solana.com/tx/3HfWVUBLpoPD3TSwT6pXEwfNLEKrZSi9qpJFLe9hH4FdumwKyTSZmSJFr227PffEmGyiAW4y5wiXRiSA1vZQpMKS?cluster=devnet
    Mint Address:  1q4S5feSENuyBvvDpuyGnL8chMHBZNEX4G4iQM2rRQm
    */

    console.log("Mint Address: ", mint.publicKey);
})();