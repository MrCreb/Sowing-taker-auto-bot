require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const blessed = require('blessed');
const colors = require('colors');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API_BASE_URL = 'https://sowing-api.taker.xyz';
const CONTRACT_ADDRESS = '0xF929AB815E8BfB84Cdab8d1bb53F22eB1e455378';
const CONTRACT_ABI = [
    {
        "constant": false,
        "inputs": [],
        "name": "active",
        "outputs": [],
        "payable": false,
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

const HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'sec-ch-ua': '"Microsoft Edge";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'Referer': 'https://sowing.taker.xyz/',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const proxies = fs.existsSync('proxies.txt')
    ? fs.readFileSync('proxies.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
    : [];
if (proxies.length === 0) {
    console.warn('No proxies found in proxies.txt. Running without proxies.');
}

const wallets = [];
for (let i = 1; ; i++) {
    const key = process.env[`PRIVATE_KEY_${i}`];
    if (!key) break;
    try {
        const wallet = new ethers.Wallet(key);
        wallets.push({
            privateKey: key,
            address: wallet.address,
            proxy: proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null,
        });
    } catch (error) {
        console.error(`Invalid PRIVATE_KEY_${i}: ${error.message}`);
    }
}
if (wallets.length === 0) {
    throw new Error('No valid private keys found in .env file');
}

const screen = blessed.screen({
    smartCSR: true,
    title: 'Taker Farming Bot'
});

const headerBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '{center}SOWING TAKER FARMING BOT - AIRDROP INSIDERS{/center}',
    tags: true,
    style: { fg: 'cyan', bg: 'black' }
});

const modeBox = blessed.box({
    top: 3,
    left: 0,
    width: '100%',
    height: 3,
    content: `{center}CURRENT MODE: {green-fg}AUTO-FARMING{/green-fg} | Wallet 1 of ${wallets.length}{/center}`,
    tags: true,
    style: { fg: 'yellow', bg: 'black', border: { fg: 'white' } },
    border: { type: 'line' }
});

const userInfoBox = blessed.box({
    top: 6,
    left: 0,
    width: '100%',
    height: 7,
    content: 'Loading user info...',
    tags: true,
    style: { fg: 'white', bg: 'black', border: { fg: 'white' } },
    border: { type: 'line' }
});

const farmingStatusBox = blessed.box({
    top: 13,
    left: 0,
    width: '100%',
    height: 9,
    content: 'Loading farming status...',
    tags: true,
    style: { fg: 'white', bg: 'black', border: { fg: 'white' } },
    border: { type: 'line' }
});

const logBox = blessed.log({
    top: 22,
    left: 0,
    width: '100%',
    height: 60,
    content: '',
    tags: true,
    scrollable: true,
    mouse: true,
    style: { fg: 'white', bg: 'black', border: { fg: 'white' } },
    border: { type: 'line' },
    scrollbar: { ch: ' ', style: { bg: 'blue' } }
});

const statusBox = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '{center}Press [q] to Quit | [r] to Refresh Tokens | [←] Prev Wallet | [→] Next Wallet{/center}',
    tags: true,
    style: { fg: 'white', bg: 'black', border: { fg: 'white' } },
    border: { type: 'line' }
});

screen.append(headerBox);
screen.append(modeBox);
screen.append(userInfoBox);
screen.append(farmingStatusBox);
screen.append(logBox);
screen.append(statusBox);

let currentWalletIndex = 0;
const tokens = {};

function logMessage(message, type = 'info', walletAddress = '') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = walletAddress ? `[${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}] ` : '';
    let coloredMessage;
    switch (type) {
        case 'error':
            coloredMessage = `{red-fg}[${timestamp}] ${prefix}${message}{/red-fg}`;
            break;
        case 'success':
            coloredMessage = `{green-fg}[${timestamp}] ${prefix}${message}{/green-fg}`;
            break;
        case 'warning':
            coloredMessage = `{yellow-fg}[${timestamp}] ${prefix}${message}{/yellow-fg}`;
            break;
        default:
            coloredMessage = `{white-fg}[${timestamp}] ${prefix}${message}{/white-fg}`;
    }
    logBox.log(coloredMessage);
    screen.render();
}

function normalizeProxy(proxy) {
    if (!proxy) return null;
    if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
        proxy = `http://${proxy}`;
    }
    return proxy;
}

async function apiRequest(url, method = 'GET', data = null, authToken = null, proxy = null) {
    const config = {
        method,
        url,
        headers: { ...HEADERS },
    };
    if (data) config.data = data;
    if (authToken) config.headers['authorization'] = `Bearer ${authToken}`;
    if (proxy) {
        config.httpsAgent = new HttpsProxyAgent(normalizeProxy(proxy));
    }
    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
    }
}

async function generateNonce(wallet) {
    const response = await apiRequest(
        `${API_BASE_URL}/wallet/generateNonce`,
        'POST',
        { walletAddress: ethers.utils.getAddress(wallet.address) }, 
        null,
        wallet.proxy
    );
    logMessage(`Nonce API response: ${JSON.stringify(response)}`, 'info', wallet.address); 
    if (response.code === 200) {
        if (response.result?.nonce) {
            return response.result.nonce; 
        } else if (typeof response.result === 'string') {
            const nonceMatch = response.result.match(/Nonce: (.*)$/m);
            if (nonceMatch && nonceMatch[1]) {
                return nonceMatch[1];
            }
        }
    }
    throw new Error('Failed to generate nonce: ' + (response.message || 'Unknown error'));
}

async function login(wallet, nonce) {
    const checksummedAddress = ethers.utils.getAddress(wallet.address);

    const message = `Taker quest needs to verify your identity to prevent unauthorized access. Please confirm your sign-in details below:\n\naddress: ${checksummedAddress}\n\nNonce: ${nonce}`;
    
    const ethersWallet = new ethers.Wallet(wallet.privateKey);

    logMessage(`Message to sign: ${message}`, 'info', wallet.address);

    let signature;
    try {
        signature = await ethersWallet.signMessage(message);
        logMessage(`Generated signature: ${signature}`, 'info', wallet.address);
    } catch (error) {
        logMessage(`Signature generation failed: ${error.message}`, 'error', wallet.address);
        throw error;
    }

    const response = await apiRequest(
        `${API_BASE_URL}/wallet/login`,
        'POST',
        { address: checksummedAddress, signature, message },
        null,
        wallet.proxy
    );

    logMessage(`Login API response: ${JSON.stringify(response)}`, 'info', wallet.address); 

    if (response.code === 200) {
        return response.result.token;
    }

    logMessage('Standard signature failed. Attempting EIP-712 signing...', 'warning', wallet.address);
    const domain = {
        name: 'Taker',
        version: '1',
        chainId: 1125, 
    };
    const types = {
        Login: [
            { name: 'address', type: 'address' },
            { name: 'nonce', type: 'string' },
        ],
    };
    const value = {
        address: checksummedAddress,
        nonce: nonce,
    };
    
    try {
        signature = await ethersWallet._signTypedData(domain, types, value);
        logMessage(`Generated EIP-712 signature: ${signature}`, 'info', wallet.address);
    } catch (error) {
        logMessage(`EIP-712 signature generation failed: ${error.message}`, 'error', wallet.address);
        throw error;
    }

    const eip712Response = await apiRequest(
        `${API_BASE_URL}/wallet/login`,
        'POST',
        { address: checksummedAddress, signature, message: JSON.stringify({ domain, types, value }) },
        null,
        wallet.proxy
    );

    logMessage(`EIP-712 login API response: ${JSON.stringify(eip712Response)}`, 'info', wallet.address);

    if (eip712Response.code === 200) {
        return eip712Response.result.token;
    }

    throw new Error('Login failed: ' + (response.message || eip712Response.message || 'Signature mismatch'));
}

async function getUserInfo(wallet, token) {
    const response = await apiRequest(
        `${API_BASE_URL}/user/info`,
        'GET',
        null,
        token,
        wallet.proxy
    );
    if (response.code === 200) {
        return response.result;
    }
    throw new Error('Failed to fetch user info: ' + response.message);
}

async function performSignIn(wallet, token) {
    const response = await apiRequest(
        `${API_BASE_URL}/task/signIn?status=true`,
        'GET',
        null,
        token,
        wallet.proxy
    );
    if (response.code === 200) {
        logMessage('Sign-in successful! Started farming.', 'success', wallet.address);
        return true;
    }
    logMessage('Sign-in failed: ' + response.message, 'error', wallet.address);
    return false;
}

async function claimReward(wallet, token) {
    try {
        logMessage('Initiating reward claim process...', 'info', wallet.address);

        logMessage('Preparing on-chain transaction...', 'info', wallet.address);

        const provider = new ethers.providers.JsonRpcProvider('https://rpc-mainnet.taker.xyz', {
            chainId: 1125,
            name: 'Taker',
            nativeCurrency: { name: 'Taker', symbol: 'TAKER', decimals: 18 }
        });

        const ethersWallet = new ethers.Wallet(wallet.privateKey, provider);

        const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, ethersWallet);

        const gasLimit = 182832;
        const maxPriorityFeePerGas = ethers.utils.parseUnits('0.11', 'gwei');
        const maxFeePerGas = ethers.utils.parseUnits('0.11135', 'gwei');

        logMessage('Sending transaction to call active()...', 'info', wallet.address);
        const tx = await contract.active({
            gasLimit,
            maxPriorityFeePerGas,
            maxFeePerGas,
            type: 2 
        });

        logMessage(`Transaction sent: ${tx.hash}`, 'info', wallet.address);
        const receipt = await tx.wait();
        logMessage(`Transaction confirmed: ${receipt.transactionHash} | Gas used: ${receipt.gasUsed}`, 'success', wallet.address);

        logMessage('Calling signIn API with status=false...', 'info', wallet.address);
        const signInResponse = await apiRequest(
            `${API_BASE_URL}/task/signIn?status=false`,
            'GET',
            null,
            token,
            wallet.proxy
        );

        if (signInResponse.code === 200) {
            logMessage('Sign-in API (status=false) successful.', 'success', wallet.address);
        } else {
            logMessage(`Sign-in API (status=false) failed: Code ${signInResponse.code} - ${signInResponse.message || 'Unknown error'}`, 'warning', wallet.address);
        }

        logMessage('Reward claimed successfully!', 'success', wallet.address);
        return true;
    } catch (error) {
        logMessage(`Error in claim process: ${error.message}`, 'error', wallet.address);
        return false;
    }
}

async function completeAndRestartFarmingCycle(wallet, token) {
    try {
        const claimSuccess = await claimReward(wallet, token);

        if (claimSuccess) {
            logMessage('Starting new farming cycle...', 'info', wallet.address);
            const signInSuccess = await performSignIn(wallet, token);

            if (signInSuccess) {
                const updatedUserInfo = await getUserInfo(wallet, token);

                if (currentWalletIndex === wallets.indexOf(wallet)) {
                    await updateUserInfo(wallet, token);
                    await updateFarmingStatus(wallet, token);
                }

                if (updatedUserInfo.nextTimestamp && updatedUserInfo.nextTimestamp > Date.now()) {
                    if (wallet.countdownInterval) {
                        clearInterval(wallet.countdownInterval);
                    }
                    startCountdown(wallet, token, updatedUserInfo.nextTimestamp);
                    return true;
                }
            }
        }

        logMessage('Failed to complete farming cycle. Will retry later.', 'warning', wallet.address);
        return false;
    } catch (error) {
        logMessage('Error in farming cycle: ' + error.message, 'error', wallet.address);
        return false;
    }
}

function formatTimeRemaining(timestamp) {
    const now = Date.now();
    const timeLeft = timestamp - now;
    if (timeLeft <= 0) return '00:00:00';
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

async function updateUserInfo(wallet, token) {
    try {
        if (!token) {
            userInfoBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{red-fg}Not authenticated{/red-fg}`
            );
            return;
        }
        const userInfo = await getUserInfo(wallet, token);
        userInfoBox.setContent(
            `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${userInfo.walletAddress}{/green-fg}\n` +
            `{yellow-fg}Taker Points:{/yellow-fg} {green-fg}${userInfo.takerPoints}{/green-fg}\n` +
            `{yellow-fg}Consecutive Sign-Ins:{/yellow-fg} {green-fg}${userInfo.consecutiveSignInCount}{/green-fg}\n` +
            `{yellow-fg}Reward Count:{/yellow-fg} {green-fg}${userInfo.rewardCount}{/green-fg}`
        );
    } catch (error) {
        logMessage('Error updating user info: ' + error.message, 'error', wallet.address);
        userInfoBox.setContent(
            `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
            `{red-fg}Failed to fetch user info{/red-fg}`
        );
    }
    screen.render();
}

async function updateFarmingStatus(wallet, token) {
    try {
        const proxyDisplay = wallet.proxy ? normalizeProxy(wallet.proxy) : 'None';
        if (!token) {
            farmingStatusBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                `{red-fg}Not authenticated{/red-fg}`
            );
            return;
        }
        const userInfo = await getUserInfo(wallet, token);

        if (userInfo.nextTimestamp && userInfo.nextTimestamp <= Date.now()) {
            farmingStatusBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                `{yellow-fg}Farming Status:{/yellow-fg} {yellow-fg}COMPLETED{/yellow-fg}\n` +
                `{yellow-fg}Action:{/yellow-fg} {yellow-fg}Automatically claiming reward and restarting...{/yellow-fg}`
            );
            screen.render();

            await completeAndRestartFarmingCycle(wallet, token);
        } else if (userInfo.nextTimestamp && userInfo.nextTimestamp > Date.now()) {
            farmingStatusBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                `{yellow-fg}Farming Status:{/yellow-fg} {green-fg}ACTIVE{/green-fg}\n` +
                `{yellow-fg}Next Farming Time:{/yellow-fg} {green-fg}${new Date(userInfo.nextTimestamp).toLocaleString()}{/green-fg}\n` +
                `{yellow-fg}Time Remaining:{/yellow-fg} {green-fg}${formatTimeRemaining(userInfo.nextTimestamp)}{/green-fg}`
            );

            if (!wallet.countdownInterval) {
                startCountdown(wallet, token, userInfo.nextTimestamp);
            }
        } else {
            farmingStatusBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                `{yellow-fg}Farming Status:{/yellow-fg} {red-fg}INACTIVE{/red-fg}\n` +
                `{yellow-fg}Action:{/yellow-fg} {yellow-fg}Starting farming...{/yellow-fg}`
            );
            screen.render();

            const signInSuccess = await performSignIn(wallet, token);
            if (signInSuccess) {
                const updatedUserInfo = await getUserInfo(wallet, token);
                farmingStatusBox.setContent(
                    `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                    `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                    `{yellow-fg}Farming Status:{/yellow-fg} {green-fg}ACTIVE{/green-fg}\n` +
                    `{yellow-fg}Next Farming Time:{/yellow-fg} {green-fg}${new Date(updatedUserInfo.nextTimestamp).toLocaleString()}{/green-fg}\n` +
                    `{yellow-fg}Time Remaining:{/yellow-fg} {green-fg}${formatTimeRemaining(updatedUserInfo.nextTimestamp)}{/green-fg}`
                );

                if (wallet.countdownInterval) {
                    clearInterval(wallet.countdownInterval);
                }
                startCountdown(wallet, token, updatedUserInfo.nextTimestamp);
            }
        }
    } catch (error) {
        const proxyDisplay = wallet.proxy ? normalizeProxy(wallet.proxy) : 'None';
        logMessage('Error updating farming status: ' + error.message, 'error', wallet.address);
        farmingStatusBox.setContent(
            `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
            `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
            `{red-fg}Failed to fetch farming status{/red-fg}`
        );
    }
    screen.render();
}

function startCountdown(wallet, token, nextTimestamp) {
    if (wallet.countdownInterval) {
        clearInterval(wallet.countdownInterval);
    }

    const updateCountdown = async () => {
        const now = Date.now();
        const timeLeft = nextTimestamp - now;

        if (timeLeft <= 0) {
            logMessage('Farming cycle complete!', 'success', wallet.address);
            clearInterval(wallet.countdownInterval);
            wallet.countdownInterval = null;

            if (currentWalletIndex === wallets.indexOf(wallet)) {
                const proxyDisplay = wallet.proxy ? normalizeProxy(wallet.proxy) : 'None';
                farmingStatusBox.setContent(
                    `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                    `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                    `{yellow-fg}Farming Status:{/yellow-fg} {yellow-fg}COMPLETED{/yellow-fg}\n` +
                    `{yellow-fg}Action:{/yellow-fg} {yellow-fg}Automatically claiming reward and restarting...{/yellow-fg}`
                );
                screen.render();
            }

            await completeAndRestartFarmingCycle(wallet, token);
            return;
        }

        if (currentWalletIndex === wallets.indexOf(wallet)) {
            const proxyDisplay = wallet.proxy ? normalizeProxy(wallet.proxy) : 'None';
            farmingStatusBox.setContent(
                `{yellow-fg}Wallet Address:{/yellow-fg} {green-fg}${wallet.address}{/green-fg}\n` +
                `{yellow-fg}Proxy:{/yellow-fg} {green-fg}${proxyDisplay}{/green-fg}\n` +
                `{yellow-fg}Farming Status:{/yellow-fg} {green-fg}ACTIVE{/green-fg}\n` +
                `{yellow-fg}Next Farming Time:{/yellow-fg} {green-fg}${new Date(nextTimestamp).toLocaleString()}{/green-fg}\n` +
                `{yellow-fg}Time Remaining:{/yellow-fg} {green-fg}${formatTimeRemaining(nextTimestamp)}{/green-fg}`
            );
            screen.render();
        }
    };

    updateCountdown();
    wallet.countdownInterval = setInterval(updateCountdown, 1000);
}

async function runBot() {
    logMessage(`Starting Taker Auto-Farming Bot for ${wallets.length} wallet(s)`, 'info');

    for (const wallet of wallets) {
        try {
            logMessage(`Using proxy: ${wallet.proxy || 'None'}`, 'info', wallet.address);
            const nonce = await generateNonce(wallet);
            logMessage('Nonce generated: ' + nonce, 'info', wallet.address);
            const token = await login(wallet, nonce);
            tokens[wallet.address] = token;
            logMessage('Login successful! Token received.', 'success', wallet.address);
        } catch (error) {
            logMessage('Login failed: ' + error.message, 'error', wallet.address);
        }
    }

    if (Object.keys(tokens).length === 0) {
        logMessage('No wallets authenticated. Exiting...', 'error');
        return;
    }

    const firstWallet = wallets[currentWalletIndex];
    await updateUserInfo(firstWallet, tokens[firstWallet.address]);
    await updateFarmingStatus(firstWallet, tokens[firstWallet.address]);

    for (const wallet of wallets) {
        const token = tokens[wallet.address];
        if (token) {
            try {
                const userInfo = await getUserInfo(wallet, token);

                if (userInfo.nextTimestamp && userInfo.nextTimestamp <= Date.now()) {
                    logMessage('Farming cycle already complete. Claiming and restarting...', 'info', wallet.address);
                    await completeAndRestartFarmingCycle(wallet, token);
                } else if (userInfo.nextTimestamp && userInfo.nextTimestamp > Date.now()) {
                    logMessage(`Farming in progress. Next claim in: ${formatTimeRemaining(userInfo.nextTimestamp)}`, 'info', wallet.address);
                    startCountdown(wallet, token, userInfo.nextTimestamp);
                } else {
                    logMessage('No active farming detected. Starting farming...', 'info', wallet.address);
                    const signInSuccess = await performSignIn(wallet, token);
                    if (signInSuccess) {
                        const updatedInfo = await getUserInfo(wallet, token);
                        if (updatedInfo.nextTimestamp) {
                            startCountdown(wallet, token, updatedInfo.nextTimestamp);
                        }
                    }
                }
            } catch (error) {
                logMessage('Error setting up farming: ' + error.message, 'error', wallet.address);
            }
        }
    }

    const farmingCheckInterval = setInterval(async () => {
        for (const wallet of wallets) {
            const token = tokens[wallet.address];
            if (token) {
                try {
                    const userInfo = await getUserInfo(wallet, token);

                    if (userInfo.nextTimestamp && userInfo.nextTimestamp <= Date.now() && !wallet.countdownInterval) {
                        logMessage('Detected completed farming cycle. Processing...', 'info', wallet.address);
                        await completeAndRestartFarmingCycle(wallet, token);
                    } else if (!userInfo.nextTimestamp) {
                        logMessage('No active farming detected. Starting farming...', 'info', wallet.address);
                        await performSignIn(wallet, token);
                    }
                } catch (error) {
                    logMessage('Error in farming check: ' + error.message, 'error', wallet.address);
                }
            }
        }
    }, 30000);

    const refreshInterval = setInterval(async () => {
        const wallet = wallets[currentWalletIndex];
        const token = tokens[wallet.address];
        if (token) {
            await updateUserInfo(wallet, token);
            await updateFarmingStatus(wallet, token);
        }
    }, 30000);

    screen.key(['q', 'C-c'], () => {
        clearInterval(refreshInterval);
        clearInterval(farmingCheckInterval);
        wallets.forEach(wallet => {
            if (wallet.countdownInterval) clearInterval(wallet.countdownInterval);
        });
        logMessage('Shutting down bot...', 'warning');
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    });

    screen.key('r', async () => {
        logMessage('Manually refreshing authentication tokens...', 'info');
        for (const wallet of wallets) {
            try {
                const nonce = await generateNonce(wallet);
                const token = await login(wallet, nonce);
                tokens[wallet.address] = token;
                logMessage('Token refreshed successfully!', 'success', wallet.address);
                if (currentWalletIndex === wallets.indexOf(wallet)) {
                    await updateUserInfo(wallet, token);
                    await updateFarmingStatus(wallet, token);
                }
            } catch (error) {
                logMessage('Token refresh failed: ' + error.message, 'error', wallet.address);
            }
        }
    });

    screen.key(['left', 'h'], () => {
        currentWalletIndex = (currentWalletIndex - 1 + wallets.length) % wallets.length;
        const wallet = wallets[currentWalletIndex];
        modeBox.setContent(`{center}CURRENT MODE: {green-fg}AUTO-FARMING{/green-fg} | Wallet ${currentWalletIndex + 1} of ${wallets.length}{/center}`);
        updateUserInfo(wallet, tokens[wallet.address]);
        updateFarmingStatus(wallet, tokens[wallet.address]);
    });

    screen.key(['right', 'l'], () => {
        currentWalletIndex = (currentWalletIndex + 1) % wallets.length;
        const wallet = wallets[currentWalletIndex];
        modeBox.setContent(`{center}CURRENT MODE: {green-fg}AUTO-FARMING{/green-fg} | Wallet ${currentWalletIndex + 1} of ${wallets.length}{/center}`);
        updateUserInfo(wallet, tokens[wallet.address]);
        updateFarmingStatus(wallet, tokens[wallet.address]);
    });

    screen.on('resize', () => {
        screen.render();
    });

    screen.render();
}

runBot();
