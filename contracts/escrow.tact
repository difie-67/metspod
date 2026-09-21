import "@stdlib/deploy";

const STATE_CREATED: Int = 0;
const STATE_FUNDED: Int = 1;
const STATE_COMPLETED: Int = 2;
const STATE_CANCELLED: Int = 3;
const STATE_RESOLVED: Int = 4;
const STORAGE_RESERVE: Int = ton("0.01");
const BUYER_PAYS_FEE_FLAG: Int = 32768;

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
    state: Int as uint8;
}

contract Escrow with Deployable {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    amount: Int as coins;
    feeBps: Int as uint16;
    state: Int as uint8;

    init(dealId: Int, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: Int, feeBps: Int) {
        require(amount > 0, "Amount must be positive");
        require(
            (feeBps >= 0 && feeBps <= 10000) ||
            (feeBps >= BUYER_PAYS_FEE_FLAG && feeBps <= BUYER_PAYS_FEE_FLAG + 10000),
            "Invalid fee"
        );
        self.dealId = dealId;
        self.buyer = buyer;
        self.seller = seller;
        self.arbiter = arbiter;
        self.platform = platform;
        self.amount = amount;
        self.feeBps = feeBps;
        self.state = STATE_CREATED;
    }

    // Exact single TON transfer from the registered buyer only.
    receive() {
        require(sender() == self.buyer, "Only buyer can fund");
        require(self.state == STATE_CREATED, "Wrong state");
        require(context().value == self.fundingAmount(), "Wrong amount");
        self.state = STATE_FUNDED;
    }

    fun buyerPaysFee(): Bool {
        return self.feeBps >= BUYER_PAYS_FEE_FLAG;
    }

    fun normalizedFeeBps(): Int {
        if (self.buyerPaysFee()) {
            return self.feeBps - BUYER_PAYS_FEE_FLAG;
        }
        return self.feeBps;
    }

    fun feeAmount(): Int {
        return (self.amount * self.normalizedFeeBps()) / 10000;
    }

    fun fundingAmount(): Int {
        if (self.buyerPaysFee()) {
            return self.amount + self.feeAmount();
        }
        return self.amount;
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

        let fee: Int = self.feeAmount();
        let sellerAmount: Int = self.amount - fee;
        if (self.buyerPaysFee()) {
            sellerAmount = self.amount;
        }
        self.pay(self.seller, sellerAmount);
        self.pay(self.platform, fee);
        self.state = STATE_COMPLETED;
        self.returnExcess(self.fundingAmount());
    }

    receive(msg: Cancel) {
        require(sender() == self.arbiter, "Only arbiter can cancel");
        require(msg.dealId == self.dealId, "Wrong deal");
        require(self.state == STATE_CREATED || self.state == STATE_FUNDED, "Cannot cancel now");
        let refundAmount: Int = 0;
        if (self.state == STATE_FUNDED) {
            refundAmount = self.fundingAmount();
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

        let fee: Int = self.feeAmount();
        let remainder: Int = self.amount - fee;
        if (self.buyerPaysFee()) {
            remainder = self.amount;
        }
        let sellerAmount: Int = (remainder * msg.sellerBps) / 10000;
        self.pay(self.seller, sellerAmount);
        self.pay(self.buyer, remainder - sellerAmount);
        self.pay(self.platform, fee);
        self.state = STATE_RESOLVED;
        self.returnExcess(self.fundingAmount());
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
            state: self.state
        };
    }
}
