

import base58 from "./dev-wallet.json"

import bs58 from 'bs58';
import promptSync from 'prompt-sync';

const prompt = promptSync();

// --- base58_to_wallet (decode) ---
function base58ToWallet() {
  const input = prompt('Enter your base58 string: ');
  try {
    const decoded = bs58.decode(input.trim());
    console.log('Wallet bytes (decoded):', Array.from(decoded));
  } catch (e) {
    console.error('Invalid base58 string:', e);
  }
}

// --- wallet_to_base58 (encode) ---
function walletToBase58() {
  const wallet = Uint8Array.from(base58);

  const encoded = bs58.encode(wallet);
  console.log('Base58 string:', encoded);
}

// --- CLI selector ---
function main() {
  const choice = prompt('Choose an option: (1) base58 -> wallet, (2) wallet -> base58: ').trim();
  if (choice === '1') {
    base58ToWallet();
  } else if (choice === '2') {
    walletToBase58();
  } else {
    console.log('Invalid option');
  }
}

main();