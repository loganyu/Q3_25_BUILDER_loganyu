import wallet from "../turbin3-wallet.json"
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { createGenericFile, createSignerFromKeypair, signerIdentity } from "@metaplex-foundation/umi"
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys"

// Create a devnet connection
const umi = createUmi('https://api.devnet.solana.com');

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(irysUploader());
umi.use(signerIdentity(signer));

(async () => {
    try {
        // Follow this JSON structure
        // https://docs.metaplex.com/programs/token-metadata/changelog/v1.0#json-structure

        const image = "https://devnet.irys.xyz/FYa891o4UZffRCXaPieUABUWBWdauPdhJ4aDfSJe94uR"
        const metadata = {
            name: "Logan Rug",
            symbol: "LOGYRUG",
            description: "Great Rug!",
            image,
            attributes: [
                {trait_type: 'colors', value: '3'}
            ],
            properties: {
                files: [
                    {
                        type: "image/png",
                        uri: "image"
                    },
                ]
            },
            creators: []
        };
        const myUri = await umi.uploader.uploadJson(metadata)
        console.log("Your metadata URI: ", myUri);
        // Your metadata URI:  https://gateway.irys.xyz/A5pcBSwHiMMz8ohKBSfx3X1bNCNVx2LAUqVS393spwn8
    }
    catch(error) {
        console.log("Oops.. Something went wrong", error);
    }
})();
