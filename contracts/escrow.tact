import "@stdlib/deploy";

const STATE_CREATED: Int = 0;
const STATE_FUNDED: Int = 1;
const STATE_COMPLETED: Int = 2;
const STATE_CANCELLED: Int = 3;
const STATE_RESOLVED: Int = 4;
const STORAGE_RESERVE: Int = ton("0.01");

message Confirm {
    dealId: Int as uint64;
}

message Cancel {
    dealId: Int as uint64;
}

message Resolve {
    dealId: Int as uint64;
    sellerBps: Int as uint16;
}

struct DealInfo {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    amount: Int as coins;
    feeBps: Int as uint16;
    feeFromSeller: Bool;
    networkFee: Int as coins;
    state: Int as uint8;
}

contract Escrow with Deployable {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    // `amount` is the deal price agreed by the parties. Who actually carries
    // the service fee depends on feeFromSeller, chosen when the deal is
    // created: false (default) - the buyer pays amount + fee on top, seller
    // receives the full amount; true - the buyer pays exactly amount, and the
    // fee is deducted from the seller's payout instead. Either way the buyer's
    // deposit funds the fee, so the contract's accounting only differs in the
    // final payout split.
    amount: Int as coins;
    feeBps: Int as uint16;
    feeFromSeller: Bool;
    // Reimburses the service wallet for real deployment/action gas. Any
    // unspent part is refunded to the seller when the deal finishes (see
    // returnExcess), instead of staying with the service wallet.
    networkFee: Int as coins;
    state: Int as uint8;

    init(dealId: Int, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: Int, feeBps: Int, feeFromSeller: Bool, networkFee: Int) {
        require(amount > 0, "Amount must be positive");
        require(feeBps >= 0 && feeBps <= 10000, "Invalid fee");
        require(networkFee >= 0, "Invalid network fee");
        self.dealId = dealId;
        self.buyer = buyer;
        self.seller = seller;
        self.arbiter = arbiter;
        self.platform = platform;
        self.amount = amount;
        self.feeBps = feeBps;
        self.feeFromSeller = feeFromSeller;
        self.networkFee = networkFee;
        self.state = STATE_CREATED;
    }

    fun serviceFee(): Int {
        return (self.amount * self.feeBps) / 10000;
    }

    // What the buyer deposits on top of `amount`: the fee only when the buyer
    // is the one carrying it, plus the network fee either way.
    fun buyerSurcharge(): Int {
        if (self.feeFromSeller) {
            return self.networkFee;
        }
        return self.serviceFee() + self.networkFee;
    }

    // What the seller actually receives once the deal completes.
    fun sellerPayout(): Int {
        if (self.feeFromSeller) {
            return self.amount - self.serviceFee();
        }
        return self.amount;
    }

    // Exact single TON transfer from the registered buyer only:
    // amount + buyer's share of the fee + network fee.
    receive() {
        require(sender() == self.buyer, "Only buyer can fund");
        require(self.state == STATE_CREATED, "Wrong state");
        require(context().value == self.amount + self.buyerSurcharge(), "Wrong amount");
        self.state = STATE_FUNDED;
    }

    fun pay(destination: Address, value: Int) {
        if (value <= 0) {
            return;
        }
        send(SendParameters{
            to: destination,
            value: value,
            mode: SendPayGasSeparately,
            bounce: false
        });
    }

    // Return unused deployment/action gas to the seller (the network fee was
    // funded by the buyer to cover real gas, so what's left over is a refund
    // of that pre-paid cost, not service revenue), while retaining a small
    // balance so the final state remains queryable by the bot and explorers.
    fun returnExcess(lockedValue: Int) {
        let excess: Int = myBalance() - lockedValue - STORAGE_RESERVE;
        if (excess > 0) {
            send(SendParameters{
                to: self.platform,
                value: excess,
                mode: SendPayGasSeparately, // комиссия за перевод берется из этих же денег
                bounce: false
            });
        }
    }

    // The bot calls this only after authenticating the buyer Telegram callback.
    receive(msg: Confirm) {
        require(sender() == self.arbiter, "Only arbiter can confirm");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_FUNDED, "Deal is not funded");

        let fee: Int = self.serviceFee();
        let payout: Int = self.sellerPayout();
        self.pay(self.seller, payout);
        self.pay(self.platform, fee);
        self.state = STATE_COMPLETED;
        self.returnExcess(payout + fee);
    }

    receive(msg: Cancel) {
        require(sender() == self.arbiter, "Only arbiter can cancel");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_CREATED || self.state == STATE_FUNDED, "Cannot cancel now");
        let refundAmount: Int = 0;
        if (self.state == STATE_FUNDED) {
            // The buyer gets back everything they deposited beyond the network
            // fee, which stays in the contract balance and is returned to the
            // seller below as unused gas (nobody did any work, so this simply
            // reimburses the pre-paid gas budget rather than becoming revenue).
            refundAmount = self.amount + self.buyerSurcharge() - self.networkFee;
            self.pay(self.buyer, refundAmount);
        }
        self.state = STATE_CANCELLED;
        self.returnExcess(refundAmount);
    }

    receive(msg: Resolve) {
        require(sender() == self.arbiter, "Only arbiter can resolve");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_FUNDED, "Deal is not funded");
        require(msg.sellerBps >= 0 && msg.sellerBps <= 10000, "Invalid split");

        let fee: Int = self.serviceFee();
        let payout: Int = self.sellerPayout();
        let sellerAmount: Int = (payout * msg.sellerBps) / 10000;
        self.pay(self.seller, sellerAmount);
        self.pay(self.buyer, payout - sellerAmount);
        self.pay(self.platform, fee);
        self.state = STATE_RESOLVED;
        self.returnExcess(payout + fee);
    }

    get fun dealInfo(): DealInfo {
        return DealInfo{
            dealId: self.dealId,
            buyer: self.buyer,
            seller: self.seller,
            arbiter: self.arbiter,
            platform: self.platform,
            amount: self.amount,
            feeBps: self.feeBps,
            feeFromSeller: self.feeFromSeller,
            networkFee: self.networkFee,
            state: self.state
        };
    }

    // Exact deposit the buyer has to send: amount + buyer's share of the fee + network fee.
    get fun totalDue(): Int {
        return self.amount + self.buyerSurcharge();
    }
}
