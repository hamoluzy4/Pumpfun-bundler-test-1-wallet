import { VersionedTransaction, Keypair, SystemProgram, Transaction, Connection, ComputeBudgetProgram, TransactionInstruction, TransactionMessage, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";
import { openAsBlob } from "fs";
import base58 from "bs58"
import { DESCRIPTION, FILE, PRIVATE_KEY, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, TELEGRAM, TOKEN_CREATE_ON, TOKEN_NAME, TOKEN_SHOW_NAME, TOKEN_SYMBOL, TWITTER, WEBSITE, SWAP_AMOUNT } from "./constants"
import { readJson, saveDataToFile, sleep } from "./utils"
import { PumpFunSDK } from "./src/pumpfun";
import { jitoWithAxios } from "./src/jitoWithAxios";
import { getAssociatedTokenAddress } from "@solana/spl-token";


const commitment = "confirmed"
const connection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment
})

const mainKp = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const versionedTxs: VersionedTransaction[] = []
const mintKp = Keypair.generate()

const mintAddress = mintKp.publicKey

let sdk = new PumpFunSDK(new AnchorProvider(connection, new NodeWallet(new Keypair()), { commitment }));

const mode = "JITO_MODE"


const main = async () => {
    console.log("======================= Bot start ========================")

    try {

        console.log("======================== Token Create =========================")

        console.log(await connection.getBalance(mainKp.publicKey) / 10 ** 9, "SOL in main keypair")

        saveDataToFile([base58.encode(mintKp.secretKey)], "mint.json")

        let tokenCreationIxs = await createTokenTx()


        if (!tokenCreationIxs) {
            console.log("creation instruction not retrieved")
            return
        }

        const ixs: TransactionInstruction[] = [
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 70_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 })
        ]

        ixs.push(
            tokenCreationIxs,
        ),

            console.log(`Token contract link: https://solscan.io/token/${mintAddress}`)

        const tokenCreateRecentBlockhash = (await connection.getLatestBlockhash().catch(async () => {
            return await connection.getLatestBlockhash().catch(getLatestBlockhashError => {
                console.log({ getLatestBlockhashError })
                return null
            })
        }))?.blockhash;
        if (!tokenCreateRecentBlockhash) return { Err: "Failed to prepare transaction" }

        const tokenCreateTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: tokenCreateRecentBlockhash,
                instructions: ixs,
            }).compileToV0Message()
        );

        tokenCreateTransaction.sign([mainKp, mintKp])
        console.log(await connection.simulateTransaction(tokenCreateTransaction, { sigVerify: true }))
        versionedTxs.push(tokenCreateTransaction)

    } catch (error) {
        console.log("Token mint error");
    }



    try {
        console.log("============= Buyer buy token =================")
        // token account rent is 0.00203SOL
        console.log("Buyer keypair :", mainKp.publicKey.toBase58());
        const buyerBalance = (await connection.getBalance(mainKp.publicKey)) / LAMPORTS_PER_SOL
        console.log("buyer keypair balance : ", buyerBalance)

        const tokenBuyix = await makeBuyIx(mainKp, Math.floor(SWAP_AMOUNT * 10 ** 9))

        if (!tokenBuyix) {
            console.log("Token buy instruction not retrieved")
            return
        }

        const ixs: TransactionInstruction[] = [
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 70_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 })
        ]
        ixs.push(...tokenBuyix);

        const buyRecentBlockhash = (await connection.getLatestBlockhash().catch(async () => {
            return await connection.getLatestBlockhash().catch(getLatestBlockhashError => {
                console.log({ getLatestBlockhashError })
                return null
            })
        }))?.blockhash;

        if (!buyRecentBlockhash) return { Err: "Failed to prepare transaction" }

        const tokenBuyTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: mainKp.publicKey,
                recentBlockhash: buyRecentBlockhash,
                instructions: ixs,
            }).compileToV0Message()
        );

        tokenBuyTransaction.sign([mainKp])
        console.log(await connection.simulateTransaction(tokenBuyTransaction, { sigVerify: true }))
        versionedTxs.push(tokenBuyTransaction)
    } catch (error) {
        console.log("================ Token buy fail ==============")
        console.log("Error in buy ", error)
    }



    if (mode == "JITO_MODE") {
        console.log("======================== create and buy ========================")
        let result;
        while (1) {
            result = await jitoWithAxios(versionedTxs, mainKp)
            if (result.confirmed) {
                console.log("Bundle signature: ", result.jitoTxsignature)
                break;
            }
        }
    } else {
        for (let i = 0; i < versionedTxs.length; i++) {
            const latestBlockhash = await connection.getLatestBlockhash()
            const sig = await connection.sendRawTransaction(versionedTxs[i].serialize())
            const confirmation = await connection.confirmTransaction({
                signature: sig,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                blockhash: latestBlockhash.blockhash,
            },
                "confirmed"
            )

            if (confirmation.value.err) {
                console.log("Confrimtaion error")
            } else {
                console.log(`Token mint and Buy transaction: https://solscan.io/tx/${sig} `);
            }
        }
    }

    await sleep(2000);

    try {
        console.log("======================== Token Sell start =========================")

        const tokenAccount = await getAssociatedTokenAddress(mintAddress, mainKp.publicKey);

        const tokenBalance = (await connection.getTokenAccountBalance(tokenAccount)).value.amount


        if (tokenBalance) {
            // console.log("tokenBalance", Math.floor(tokenBalance * 10 ** 5));

            const tokenSellix = await makeSellIx(mainKp, Number(tokenBalance))
            console.log(tokenSellix);
            if (!tokenSellix) {
                console.log("Token buy instruction not retrieved")
                return
            }

            const tx = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 100_000,
                }),
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: 200_000,
                }),
                tokenSellix

            )

            tx.feePayer = mainKp.publicKey
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

            console.log(await connection.simulateTransaction(tx))

            const signature = await sendAndConfirmTransaction(connection, tx, [mainKp], { skipPreflight: true, commitment: commitment });

            console.log(`Sell Tokens : https://solscan.io/tx/${signature}`)

        }

        console.log("======================== Token Sell end ==========================")

    } catch (error) {
        console.log("======================== Token Sell fail =========================")
    }

}

// create token instructions
const createTokenTx = async () => {
    try {

        const tokenInfo = {
            name: TOKEN_NAME,
            symbol: TOKEN_SYMBOL,
            description: DESCRIPTION,
            showName: TOKEN_SHOW_NAME,
            createOn: TOKEN_CREATE_ON,
            twitter: TWITTER,
            telegram: TELEGRAM,
            website: WEBSITE,
            file: await openAsBlob(FILE),
        };

        let tokenMetadata = await sdk.createTokenMetadata(tokenInfo);

        if (tokenMetadata.metadataUri) {
            let createIx = await sdk.getCreateInstructions(
                mainKp.publicKey,
                tokenInfo.name,
                tokenInfo.symbol,
                tokenMetadata.metadataUri,
                mintKp
            );

            return createIx;
        } else {
            console.log("================ TokenMEtadata error ===============")
            return
        }
    } catch (error) {

        console.error(error)
    }

}

// make buy instructions
const makeBuyIx = async (kp: Keypair, buyAmount: number) => {
    let buyIx = await sdk.getBuyInstructionsBySolAmount(
        kp.publicKey,
        mintAddress,
        BigInt(buyAmount),
        BigInt(10000000),
        commitment
    );
    console.log("Buyamount:", buyAmount);

    return buyIx
}


// make sell instructions
const makeSellIx = async (kp: Keypair, sellAmount: number) => {
    let sellIx = await sdk.getSellInstructionsByTokenAmount(
        kp.publicKey,
        mintAddress,
        BigInt(sellAmount),
        BigInt(100),
        commitment
    );

    console.log("Sellamount:", sellAmount);

    return sellIx
}


main()