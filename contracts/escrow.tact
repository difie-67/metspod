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
    networkFee: Int as coins;
    state: Int as uint8;
}

contract Escrow with Deployable {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    // `amount` is the net sum the seller receives. On top of it the buyer pays
    // the service fee (feeBps of amount) and a network fee that reimburses the
    // service wallet for deployment/action gas. Whatever is left in the
    // contract after the payouts (the network fee plus unused gas) goes back to
    // the service wallet, so the real on-chain cost is covered per deal.
    amount: Int as coins;
    feeBps: Int as uint16;
    networkFee: Int as coins;
    state: Int as uint8;

    init(dealId: Int, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: Int, feeBps: Int, networkFee: Int) {
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
        self.networkFee = networkFee;
        self.state = STATE_CREATED;
    }

    fun serviceFee(): Int {
        return (self.amount * self.feeBps) / 10000;
    }

    // Exact single TON transfer from the registered buyer only:
    // amount + service fee + network fee.
    receive() {
        require(sender() == self.buyer, "Only buyer can fund");
        require(self.state == STATE_CREATED, "Wrong state");
        require(context().value == self.amount + self.serviceFee() + self.networkFee, "Wrong amount");
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

    // Return unused deployment/action gas while retaining a small balance so
    // the final state remains queryable by the bot and explorers.
    fun returnExcess(lockedValue: Int) {
        let excess: Int = myBalance() - lockedValue - STORAGE_RESERVE;
        if (excess > 0) {
            self.pay(self.arbiter, excess);
        }
    }

    // The bot calls this only after authenticating the buyer Telegram callback.
    receive(msg: Confirm) {
        require(sender() == self.arbiter, "Only arbiter can confirm");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_FUNDED, "Deal is not funded");

        let fee: Int = self.serviceFee();
        self.pay(self.seller, self.amount);
        self.pay(self.platform, fee);
        self.state = STATE_COMPLETED;
        self.returnExcess(self.amount + fee);
    }

    receive(msg: Cancel) {
        require(sender() == self.arbiter, "Only arbiter can cancel");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_CREATED || self.state == STATE_FUNDED, "Cannot cancel now");
        let refundAmount: Int = 0;
        if (self.state == STATE_FUNDED) {
            // The service fee is returned; the network fee stays with the
            // service wallet because the gas has already been spent.
            refundAmount = self.amount + self.serviceFee();
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
        let sellerAmount: Int = (self.amount * msg.sellerBps) / 10000;
        self.pay(self.seller, sellerAmount);
        self.pay(self.buyer, self.amount - sellerAmount);
        self.pay(self.platform, fee);
        self.state = STATE_RESOLVED;
        self.returnExcess(self.amount + fee);
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
            networkFee: self.networkFee,
            state: self.state
        };
    }

    // Exact deposit the buyer has to send: amount + service fee + network fee.
    get fun totalDue(): Int {
        return self.amount + self.serviceFee() + self.networkFee;
    }
}
