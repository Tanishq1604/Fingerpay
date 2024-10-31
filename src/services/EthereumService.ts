// EthereumService.ts
import "react-native-get-random-values";
import "@ethersproject/shims";

import {
  Wallet,
  isAddress,
  JsonRpcProvider,
  WebSocketProvider,
  formatEther,
  parseEther,
  HDNodeWallet,
  Mnemonic,
  AddressLike,
} from "ethers";
import { validateMnemonic } from "bip39";
import { Alchemy, Network } from "alchemy-sdk";
import uuid from "react-native-uuid";
import { truncateBalance } from "../utils/truncateBalance";

// Interfaces
interface ExtendedHDNodeWallet extends HDNodeWallet {
  derivationPath: string;
}

interface SendTransactionResponse {
  gasEstimate: string;
  totalCost: string;
  totalCostMinusGas: string;
  gasFee: bigint;
}

import { AssetTransfersCategory } from "alchemy-sdk";

interface AssetTransferParams {
  fromBlock: string;
  excludeZeroValue: boolean;
  withMetadata: true;
  maxCount?: number;
  toAddress?: string;
  fromAddress?: string;
  pageKey?: string;
  category: AssetTransfersCategory[];
}

interface NovesTransaction {
  hash: string;
  timestamp: number;
  from: string;
  to: string;
  type: string;
  category: string;
  description: string;
  value: number;
  token?: {
    symbol: string;
    decimals: number;
    address: string;
    name: string;
    logo?: string;
  };
  metadata?: {
    protocol?: string;
    action?: string;
    tokens?: Array<{
      amount: number;
      symbol: string;
      address: string;
    }>;
    nft?: {
      tokenId: string;
      collection: string;
      name?: string;
      image?: string;
    };
  };
  status: 'success' | 'failed' | 'pending';
  gasUsed?: number;
  gasPrice?: number;
}

interface TransactionOptions {
  limit?: number;
  before?: string;
  after?: string;
  types?: string[];
  includeMetadata?: boolean;
}

class EthereumService {
  private provider: JsonRpcProvider;
  private webSocketProvider: WebSocketProvider;
  private alchemy: Alchemy;
  private novesApiKey: string;
  private novesBaseUrl: string;
  private readonly DEFAULT_TIMEOUT = 10000; 

  constructor(
    private apiKey: string,
    private ethUrl: string,
    private socketUrl: string,
    private environment: string
  ) {
    const network =
      environment === "production" ? Network.ETH_MAINNET : Network.ETH_SEPOLIA;
    this.provider = new JsonRpcProvider(ethUrl + apiKey);
    this.webSocketProvider = new WebSocketProvider(socketUrl + apiKey);
    this.alchemy = new Alchemy({
      apiKey: apiKey,
      network: network,
    });
    this.novesApiKey = process.env.EXPO_PUBLIC_NOVES_API_KEY;
    this.novesBaseUrl = process.env.EXPO_PUBLIC_NOVES_API_URL || 'https://api.noves.xyz';
  }

  // Wallet Creation and Management Methods
  async createWallet(): Promise<HDNodeWallet> {
    return new Promise((resolve, reject) => {
      try {
        const wallet = HDNodeWallet.createRandom();
        resolve(wallet);
      } catch (error) {
        reject(new Error("Failed to create wallet: " + error.message));
      }
    });
  }

  async restoreWalletFromPhrase(mnemonicPhrase: string): Promise<HDNodeWallet> {
    if (!mnemonicPhrase) {
      throw new Error("Mnemonic phrase cannot be empty.");
    }

    if (!validateMnemonic(mnemonicPhrase)) {
      throw new Error("Invalid mnemonic phrase");
    }

    try {
      const ethWallet = HDNodeWallet.fromPhrase(mnemonicPhrase);
      return ethWallet;
    } catch (error) {
      throw new Error(
        "Failed to restore wallet from mnemonic: " + (error as Error).message
      );
    }
  }

  async derivePrivateKeysFromPhrase(
    mnemonicPhrase: string,
    derivationPath: string
  ) {
    if (!mnemonicPhrase) {
      throw new Error("Empty mnemonic phrase");
    }

    if (!validateMnemonic(mnemonicPhrase)) {
      throw new Error("Invalid mnemonic phrase");
    }

    const mnemonic = Mnemonic.fromPhrase(mnemonicPhrase);
    try {
      const ethWallet = HDNodeWallet.fromMnemonic(mnemonic, derivationPath);
      return ethWallet.privateKey;
    } catch (error) {
      throw new Error(
        "Failed to derive wallet from mnemonic: " + (error as Error).message
      );
    }
  }

  async createWalletByIndex(
    phrase: string,
    index: number = 0
  ): Promise<ExtendedHDNodeWallet> {
    try {
      const mnemonic = Mnemonic.fromPhrase(phrase);
      const path = `m/44'/60'/0'/0/${index}`;
      const wallet = HDNodeWallet.fromMnemonic(mnemonic, path);
      const extendedWallet: ExtendedHDNodeWallet = Object.assign(wallet, {
        derivationPath: path,
      });
      return extendedWallet;
    } catch (error) {
      throw new Error(
        "Failed to create Ethereum wallet by index: " + (error as Error).message
      );
    }
  }

  // Transaction Methods
  async sendTransaction(
    toAddress: AddressLike,
    privateKey: string,
    value: string
  ): Promise<any> {
    const signer = new Wallet(privateKey, this.provider);
    const transaction = {
      to: toAddress,
      value: parseEther(value),
    };
    try {
      const response = await signer.sendTransaction(transaction);
      return response;
    } catch (error) {
      console.error("Failed to send transaction:", error);
      throw new Error("Failed to send transaction. Please try again later.");
    }
  }

  async calculateGasAndAmounts(
    toAddress: string,
    amount: string
  ): Promise<SendTransactionResponse> {
    const amountInWei = parseEther(amount.toString());
    const transaction = {
      to: toAddress,
      value: amountInWei,
    };
    try {
      const gasEstimate = await this.provider.estimateGas(transaction);
      const gasFee = (await this.provider.getFeeData()).maxFeePerGas;
      const gasPrice = BigInt(gasEstimate) * BigInt(gasFee);
      const totalCost = amountInWei + gasPrice;
      const totalCostMinusGas = amountInWei - gasPrice;

      return {
        gasEstimate: formatEther(gasPrice),
        totalCost: formatEther(totalCost),
        totalCostMinusGas: formatEther(totalCostMinusGas),
        gasFee,
      };
    } catch (error) {
      console.error("Failed to calculate gas:", error);
      throw new Error("Unable to calculate gas. Please try again later.");
    }
  }

  // Noves Integration Methods
  private async novesApiRequest(endpoint: string, params: Record<string, any> = {}) {
    if (!this.novesApiKey) {
      throw new Error('Noves API key is not configured');
    }

    const url = new URL(`${this.novesBaseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, value.toString());
      }
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT);

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.novesApiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Noves API error: ${errorData.message || response.statusText}`);
      }

      return response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Noves API request timed out');
      }
      throw error;
    }
  }

  async fetchEnrichedTransactions(
    address: string,
    options: TransactionOptions = {}
  ) {
    if (!isAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    try {
      const params = {
        address,
        limit: options.limit || 50,
        before: options.before,
        after: options.after,
        types: options.types?.join(','),
        include_metadata: options.includeMetadata
      };

      const response = await this.novesApiRequest('/v1/ethereum/translate', params);
      
      if (!response?.transactions) {
        throw new Error('Invalid response format from Noves API');
      }

      return this.transformNovesTransactions(response.transactions);
    } catch (error) {
      console.error('Error fetching enriched transactions:', error);
      throw new Error('Failed to fetch enriched transaction history');
    }
  }
  private transformNovesTransactions(transactions: NovesTransaction[]) {
    return transactions.map(tx => ({
      uniqueId: uuid.v4(),
      hash: tx.hash,
      timestamp: tx.timestamp,
      from: tx.from,
      to: tx.to,
      type: tx.type,
      category: tx.category,
      description: tx.description,
      value: tx.value,
      token: tx.token,
      metadata: tx.metadata,
      status: tx.status,
      gasUsed: tx.gasUsed,
      gasPrice: tx.gasPrice
    }));
  }

  async getTransactionDetails(txHash: string) {
    try {
      const response = await this.novesApiRequest(`/v1/ethereum/translate/${txHash}`);
      return this.transformNovesTransactions([response.transaction])[0];
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      throw new Error('Failed to fetch transaction details');
    }
  }

  // Legacy Transaction Fetching with Fallback
  async fetchTransactions(address: string, pageKeys?: string[]): Promise<any> {
    if (!isAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }

    try {
      // Only attempt Noves if API key is configured
      if (this.novesApiKey) {
        try {
          const enrichedTransactions = await this.fetchEnrichedTransactions(address);
          return {
            transferHistory: enrichedTransactions,
            paginationKey: pageKeys
          };
        } catch (error) {
          console.warn('Noves API request failed, falling back to Alchemy:', error.message);
        }
      }
      
      // Fallback to Alchemy
      const paramsBuilder = (): AssetTransferParams => ({
        fromBlock: "0x0",
        excludeZeroValue: false,
        withMetadata: true,
        category: [
          AssetTransfersCategory.INTERNAL,
          AssetTransfersCategory.EXTERNAL,
          AssetTransfersCategory.ERC20,
          AssetTransfersCategory.ERC721,
          AssetTransfersCategory.ERC1155,
          AssetTransfersCategory.SPECIALNFT,
        ],
      });

      const sentParams = paramsBuilder();
      const receivedParams = paramsBuilder();

      if (pageKeys && pageKeys.length === 2) {
        sentParams.pageKey = pageKeys[0];
        receivedParams.pageKey = pageKeys[1];
      }

      sentParams.fromAddress = address;
      receivedParams.toAddress = address;

      const [sentTransfers, receivedTransfers] = await Promise.all([
        this.alchemy.core.getAssetTransfers(sentParams),
        this.alchemy.core.getAssetTransfers(receivedParams)
      ]);

      const transformTransfers = (txs: any, direction: string) =>
        txs.map((tx: any) => ({
          ...tx,
          uniqueId: uuid.v4(),
          value: parseFloat(truncateBalance(tx.value)),
          blockTime: new Date(tx.metadata.blockTimestamp).getTime() / 1000,
          direction,
        }));

      const allTransfers = [
        ...transformTransfers(sentTransfers.transfers, "sent"),
        ...transformTransfers(receivedTransfers.transfers, "received"),
      ].sort((a, b) => b.blockTime - a.blockTime);

      return {
        transferHistory: allTransfers,
        paginationKey: [sentTransfers.pageKey, receivedTransfers.pageKey],
      };
    } catch (error) {
      console.error('Error fetching transactions:', error);
      throw new Error('Failed to fetch transaction history');
    }
  }


  // Utility Methods
  validateAddress(address: string): boolean {
    return isAddress(address);
  }

  async findNextUnusedWalletIndex(phrase: string, index: number = 0) {
    if (!phrase) {
      throw new Error("Empty mnemonic phrase");
    }

    if (!validateMnemonic(phrase)) {
      throw new Error("Invalid mnemonic phrase");
    }

    let currentIndex = index;
    const mnemonic = Mnemonic.fromPhrase(phrase);

    while (true) {
      const path = `m/44'/60'/0'/0/${currentIndex}`;
      const wallet = HDNodeWallet.fromMnemonic(mnemonic, path);
      const transactions = await this.fetchTransactions(wallet.address);
      if (transactions.transferHistory.length === 0) {
        break;
      }
      currentIndex += 1;
    }

    return currentIndex > 0 ? currentIndex + 1 : 0;
  }

  async importAllActiveAddresses(mnemonicPhrase: string, index?: number) {
    if (index) {
      return this.collectedUsedAddresses(mnemonicPhrase, index);
    } else {
      const unusedAddressIndex = await this.findNextUnusedWalletIndex(mnemonicPhrase);
      return this.collectedUsedAddresses(mnemonicPhrase, unusedAddressIndex);
    }
  }

  async collectedUsedAddresses(phrase: string, unusedIndex: number) {
    const startingIndex = unusedIndex > 0 ? unusedIndex - 1 : unusedIndex;
    const mnemonic = Mnemonic.fromPhrase(phrase);
    const addressesUsed = [];

    for (let i = 0; i <= startingIndex; i++) {
      const path = `m/44'/60'/0'/0/${i}`;
      const wallet = HDNodeWallet.fromMnemonic(mnemonic, path);
      const walletWithDetails = {
        ...wallet,
        derivationPath: path,
      };
      addressesUsed.push(walletWithDetails);
    }

    return addressesUsed;
  }

  async getBalance(address: AddressLike): Promise<bigint> {
    try {
      return this.provider.getBalance(address);
    } catch (err) {
      console.error("Error fetching balance:", err);
      throw err;
    }
  }

  async confirmTransaction(txHash: string): Promise<boolean> {
    try {
      const receipt = await this.provider.waitForTransaction(txHash);
      return receipt.status === 1;
    } catch (error) {
      console.error("Error confirming Ethereum transaction:", error);
      return false;
    }
  }

  // Provider Access Methods
  getWebSocketProvider() {
    return this.webSocketProvider;
  }

  getProvider() {
    return this.provider;
  }
}

// Create and export service instance
const ethService = new EthereumService(
  process.env.EXPO_PUBLIC_ALCHEMY_ETH_KEY,
  process.env.EXPO_PUBLIC_ALCHEMY_ETH_URL,
  process.env.EXPO_PUBLIC_ALCHEMY_SOCKET_URL,
  process.env.EXPO_PUBLIC_ENVIRONMENT
);

export default ethService;