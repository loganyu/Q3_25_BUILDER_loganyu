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
        uri: "https://devnet.irys.xyz/DCgviiLmH27hqCAqKu5USCyM7h2shHz9pkgMRLT95KL5",
        sellerFeeBasisPoints: percentAmount(5),
    })
    let result = await tx.sendAndConfirm(umi);
    const signature = base58.encode(result.signature);
    
    console.log(`Succesfully Minted! Check out your TX here:\nhttps://explorer.solana.com/tx/${signature}?cluster=devnet`)
    /*
    Succesfully Minted! Check out your TX here:
    https://explorer.solana.com/tx/3g7ErVEtMsCrgkMcTyt97q5j4XZXgeKpfo6WSvE3UYP9GfzzZ9zWWKVbeSWp7TL5ZNDwez1bzHs12UJbgFLvaKKE?cluster=devnet
    Mint Address:  8UUg1Ve58Vv8v38KpnmQtkeZa1d9dBti2TQGavA9QfvQ
    */

    console.log("Mint Address: ", mint.publicKey);
})();