import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type Deploy = {
    $$type: 'Deploy';
    queryId: bigint;
}

export function storeDeploy(src: Deploy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2490013878, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadDeploy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2490013878) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function loadTupleDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function loadGetterTupleDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'Deploy' as const, queryId: _queryId };
}

export function storeTupleDeploy(source: Deploy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserDeploy(): DictionaryValue<Deploy> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeploy(src)).endCell());
        },
        parse: (src) => {
            return loadDeploy(src.loadRef().beginParse());
        }
    }
}

export type DeployOk = {
    $$type: 'DeployOk';
    queryId: bigint;
}

export function storeDeployOk(src: DeployOk) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2952335191, 32);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadDeployOk(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2952335191) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function loadTupleDeployOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function loadGetterTupleDeployOk(source: TupleReader) {
    const _queryId = source.readBigNumber();
    return { $$type: 'DeployOk' as const, queryId: _queryId };
}

export function storeTupleDeployOk(source: DeployOk) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserDeployOk(): DictionaryValue<DeployOk> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployOk(src)).endCell());
        },
        parse: (src) => {
            return loadDeployOk(src.loadRef().beginParse());
        }
    }
}

export type FactoryDeploy = {
    $$type: 'FactoryDeploy';
    queryId: bigint;
    cashback: Address;
}

export function storeFactoryDeploy(src: FactoryDeploy) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1829761339, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeAddress(src.cashback);
    };
}

export function loadFactoryDeploy(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1829761339) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _cashback = sc_0.loadAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function loadTupleFactoryDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _cashback = source.readAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function loadGetterTupleFactoryDeploy(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _cashback = source.readAddress();
    return { $$type: 'FactoryDeploy' as const, queryId: _queryId, cashback: _cashback };
}

export function storeTupleFactoryDeploy(source: FactoryDeploy) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeAddress(source.cashback);
    return builder.build();
}

export function dictValueParserFactoryDeploy(): DictionaryValue<FactoryDeploy> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeFactoryDeploy(src)).endCell());
        },
        parse: (src) => {
            return loadFactoryDeploy(src.loadRef().beginParse());
        }
    }
}

export type Confirm = {
    $$type: 'Confirm';
    dealId: bigint;
}

export function storeConfirm(src: Confirm) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(464539961, 32);
        b_0.storeUint(src.dealId, 64);
    };
}

export function loadConfirm(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 464539961) { throw Error('Invalid prefix'); }
    const _dealId = sc_0.loadUintBig(64);
    return { $$type: 'Confirm' as const, dealId: _dealId };
}

export function loadTupleConfirm(source: TupleReader) {
    const _dealId = source.readBigNumber();
    return { $$type: 'Confirm' as const, dealId: _dealId };
}

export function loadGetterTupleConfirm(source: TupleReader) {
    const _dealId = source.readBigNumber();
    return { $$type: 'Confirm' as const, dealId: _dealId };
}

export function storeTupleConfirm(source: Confirm) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.dealId);
    return builder.build();
}

export function dictValueParserConfirm(): DictionaryValue<Confirm> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeConfirm(src)).endCell());
        },
        parse: (src) => {
            return loadConfirm(src.loadRef().beginParse());
        }
    }
}

export type Cancel = {
    $$type: 'Cancel';
    dealId: bigint;
}

export function storeCancel(src: Cancel) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(764504475, 32);
        b_0.storeUint(src.dealId, 64);
    };
}

export function loadCancel(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 764504475) { throw Error('Invalid prefix'); }
    const _dealId = sc_0.loadUintBig(64);
    return { $$type: 'Cancel' as const, dealId: _dealId };
}

export function loadTupleCancel(source: TupleReader) {
    const _dealId = source.readBigNumber();
    return { $$type: 'Cancel' as const, dealId: _dealId };
}

export function loadGetterTupleCancel(source: TupleReader) {
    const _dealId = source.readBigNumber();
    return { $$type: 'Cancel' as const, dealId: _dealId };
}

export function storeTupleCancel(source: Cancel) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.dealId);
    return builder.build();
}

export function dictValueParserCancel(): DictionaryValue<Cancel> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCancel(src)).endCell());
        },
        parse: (src) => {
            return loadCancel(src.loadRef().beginParse());
        }
    }
}

export type Resolve = {
    $$type: 'Resolve';
    dealId: bigint;
    sellerBps: bigint;
}

export function storeResolve(src: Resolve) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(87817835, 32);
        b_0.storeUint(src.dealId, 64);
        b_0.storeUint(src.sellerBps, 16);
    };
}

export function loadResolve(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 87817835) { throw Error('Invalid prefix'); }
    const _dealId = sc_0.loadUintBig(64);
    const _sellerBps = sc_0.loadUintBig(16);
    return { $$type: 'Resolve' as const, dealId: _dealId, sellerBps: _sellerBps };
}

export function loadTupleResolve(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _sellerBps = source.readBigNumber();
    return { $$type: 'Resolve' as const, dealId: _dealId, sellerBps: _sellerBps };
}

export function loadGetterTupleResolve(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _sellerBps = source.readBigNumber();
    return { $$type: 'Resolve' as const, dealId: _dealId, sellerBps: _sellerBps };
}

export function storeTupleResolve(source: Resolve) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.dealId);
    builder.writeNumber(source.sellerBps);
    return builder.build();
}

export function dictValueParserResolve(): DictionaryValue<Resolve> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeResolve(src)).endCell());
        },
        parse: (src) => {
            return loadResolve(src.loadRef().beginParse());
        }
    }
}

export type DealInfo = {
    $$type: 'DealInfo';
    dealId: bigint;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    amount: bigint;
    feeBps: bigint;
    state: bigint;
}

export function storeDealInfo(src: DealInfo) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(src.dealId, 64);
        b_0.storeAddress(src.buyer);
        b_0.storeAddress(src.seller);
        b_0.storeAddress(src.arbiter);
        const b_1 = new Builder();
        b_1.storeAddress(src.platform);
        b_1.storeCoins(src.amount);
        b_1.storeUint(src.feeBps, 16);
        b_1.storeUint(src.state, 8);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadDealInfo(slice: Slice) {
    const sc_0 = slice;
    const _dealId = sc_0.loadUintBig(64);
    const _buyer = sc_0.loadAddress();
    const _seller = sc_0.loadAddress();
    const _arbiter = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _platform = sc_1.loadAddress();
    const _amount = sc_1.loadCoins();
    const _feeBps = sc_1.loadUintBig(16);
    const _state = sc_1.loadUintBig(8);
    return { $$type: 'DealInfo' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function loadTupleDealInfo(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _buyer = source.readAddress();
    const _seller = source.readAddress();
    const _arbiter = source.readAddress();
    const _platform = source.readAddress();
    const _amount = source.readBigNumber();
    const _feeBps = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'DealInfo' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function loadGetterTupleDealInfo(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _buyer = source.readAddress();
    const _seller = source.readAddress();
    const _arbiter = source.readAddress();
    const _platform = source.readAddress();
    const _amount = source.readBigNumber();
    const _feeBps = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'DealInfo' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function storeTupleDealInfo(source: DealInfo) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.dealId);
    builder.writeAddress(source.buyer);
    builder.writeAddress(source.seller);
    builder.writeAddress(source.arbiter);
    builder.writeAddress(source.platform);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.feeBps);
    builder.writeNumber(source.state);
    return builder.build();
}

export function dictValueParserDealInfo(): DictionaryValue<DealInfo> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDealInfo(src)).endCell());
        },
        parse: (src) => {
            return loadDealInfo(src.loadRef().beginParse());
        }
    }
}

export type Escrow$Data = {
    $$type: 'Escrow$Data';
    dealId: bigint;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    amount: bigint;
    feeBps: bigint;
    state: bigint;
}

export function storeEscrow$Data(src: Escrow$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(src.dealId, 64);
        b_0.storeAddress(src.buyer);
        b_0.storeAddress(src.seller);
        b_0.storeAddress(src.arbiter);
        const b_1 = new Builder();
        b_1.storeAddress(src.platform);
        b_1.storeCoins(src.amount);
        b_1.storeUint(src.feeBps, 16);
        b_1.storeUint(src.state, 8);
        b_0.storeRef(b_1.endCell());
    };
}

export function loadEscrow$Data(slice: Slice) {
    const sc_0 = slice;
    const _dealId = sc_0.loadUintBig(64);
    const _buyer = sc_0.loadAddress();
    const _seller = sc_0.loadAddress();
    const _arbiter = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _platform = sc_1.loadAddress();
    const _amount = sc_1.loadCoins();
    const _feeBps = sc_1.loadUintBig(16);
    const _state = sc_1.loadUintBig(8);
    return { $$type: 'Escrow$Data' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function loadTupleEscrow$Data(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _buyer = source.readAddress();
    const _seller = source.readAddress();
    const _arbiter = source.readAddress();
    const _platform = source.readAddress();
    const _amount = source.readBigNumber();
    const _feeBps = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'Escrow$Data' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function loadGetterTupleEscrow$Data(source: TupleReader) {
    const _dealId = source.readBigNumber();
    const _buyer = source.readAddress();
    const _seller = source.readAddress();
    const _arbiter = source.readAddress();
    const _platform = source.readAddress();
    const _amount = source.readBigNumber();
    const _feeBps = source.readBigNumber();
    const _state = source.readBigNumber();
    return { $$type: 'Escrow$Data' as const, dealId: _dealId, buyer: _buyer, seller: _seller, arbiter: _arbiter, platform: _platform, amount: _amount, feeBps: _feeBps, state: _state };
}

export function storeTupleEscrow$Data(source: Escrow$Data) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.dealId);
    builder.writeAddress(source.buyer);
    builder.writeAddress(source.seller);
    builder.writeAddress(source.arbiter);
    builder.writeAddress(source.platform);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.feeBps);
    builder.writeNumber(source.state);
    return builder.build();
}

export function dictValueParserEscrow$Data(): DictionaryValue<Escrow$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEscrow$Data(src)).endCell());
        },
        parse: (src) => {
            return loadEscrow$Data(src.loadRef().beginParse());
        }
    }
}

 type Escrow_init_args = {
    $$type: 'Escrow_init_args';
    dealId: bigint;
    buyer: Address;
    seller: Address;
    arbiter: Address;
    platform: Address;
    amount: bigint;
    feeBps: bigint;
}

function initEscrow_init_args(src: Escrow_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.dealId, 257);
        b_0.storeAddress(src.buyer);
        b_0.storeAddress(src.seller);
        const b_1 = new Builder();
        b_1.storeAddress(src.arbiter);
        b_1.storeAddress(src.platform);
        b_1.storeInt(src.amount, 257);
        const b_2 = new Builder();
        b_2.storeInt(src.feeBps, 257);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

async function Escrow_init(dealId: bigint, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: bigint, feeBps: bigint) {
    const __code = Cell.fromHex('b5ee9c7241021401000486000228ff008e88f4a413f4bcf2c80bed5320e303ed43d9010302cda67858fb5134348000639560404075c03e903e903500743e903e9020404075c0350c3420404075c00c0411c411841141f4554160803bb3c8b0803cbd205b2f4870bfe5486049c42ee45c38a45fe78860c3afa588608029c42ee45c38b8bcbd1c38c376cf1b222004020010547765547765537602f83001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e55810101d700fa40fa40d401d0fa40fa40810101d700d430d0810101d7003010471046104507d155058200eecf22c200f2f4816cbd21c2ff9521812710bb9170e2917f9e21830ebe96218200a710bb9170e2e2f2f470e30d09925f09e00405003cd33ffa40fa40fa40d401d0fa40fa00d30fd3073010481047104610456c1804687028d74920c21f953108d31f09de2182101bb05139bae3022182102d91699bbae302218210053bfe6bbae302218210946a98b6ba0608090e049e5b07d33f30817d0ff84225c705f2f48200d59e5117baf2f48145a928c001f2f410575514db3c5330a15571db3c9438544118de25108907081056104510344130db3c2310891078106705061034413011130d070368db3c307254776554776553765577db3c6c81db3cc87f01ca0055705078cb3f15ce13cece01c8ce58fa0212cb0f12cb07cdc9ed540d100c03d85b07d33f308200a1dbf84225c705f2f48200d59e5117baf2f48127a728c000917f9328c001e2f2f47028c0018f133010575514db3c27108955605199db3c3055509138e2105755147301db3cc87f01ca0055705078cb3f15ce13cece01c8ce58fa0212cb0f12cb07cdc9ed54100d0c04c65b07d33fd30f30f84225c705f2e4ec8200d59e5128ba12f2f48145a929c001f2f48200e7cb21812710bbf2f410671056104510344138db3c5330a15571db3c9438544118de528ba8812710a904543a5adb3c508aa12510790810571046103544134aaa11130d0a0442db3c23108910781067050610344130db3c307454776554776553765577db3c6c810d0d100b0144db3cc87f01ca0055705078cb3f15ce13cece01c8ce58fa0212cb0f12cb07cdc9ed540c0130f8276f1001a18208989680a120c2008e845250db3c9130e20d007e20c101915be07170136d6d50436d03c8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0001e68e615b07d33f30c8018210aff90f5758cb1fcb3fc91068105710461035443012f84270705003804201503304c8cf8580ca00cf8440ce01fa02806acf40f400c901fb00c87f01ca0055705078cb3f15ce13cece01c8ce58fa0212cb0f12cb07cdc9ed54e039c00008c12118b0e3025f08f2c0820f01988200b2fbf84226c705f2f48143c228c000f2f4814813f8416f24135f035089db3c3119ba17f2f41046551371c87f01ca0055705078cb3f15ce13cece01c8ce58fa0212cb0f12cb07cdc9ed54100232db3c8e93225570db3c19a0107810671056104510344130e02213110130225570db3c19a8812710a904107810671056104510344130120112db3c9421830ea1e02113000821830ebe8a70c9dd');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initEscrow_init_args({ $$type: 'Escrow_init_args', dealId, buyer, seller, arbiter, platform, amount, feeBps })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const Escrow_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    1260: { message: "Only arbiter can resolve" },
    10151: { message: "Cannot cancel now" },
    17346: { message: "Wrong state" },
    17833: { message: "Deal is not funded" },
    18451: { message: "Wrong amount" },
    27837: { message: "Invalid fee" },
    32015: { message: "Only arbiter can confirm" },
    41435: { message: "Only arbiter can cancel" },
    45819: { message: "Only buyer can fund" },
    54686: { message: "Wrong deal" },
    59339: { message: "Invalid split" },
    61135: { message: "Amount must be positive" },
} as const

export const Escrow_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "Only arbiter can resolve": 1260,
    "Cannot cancel now": 10151,
    "Wrong state": 17346,
    "Deal is not funded": 17833,
    "Wrong amount": 18451,
    "Invalid fee": 27837,
    "Only arbiter can confirm": 32015,
    "Only arbiter can cancel": 41435,
    "Only buyer can fund": 45819,
    "Wrong deal": 54686,
    "Invalid split": 59339,
    "Amount must be positive": 61135,
} as const

const Escrow_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"Deploy","header":2490013878,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"DeployOk","header":2952335191,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"FactoryDeploy","header":1829761339,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"cashback","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"Confirm","header":464539961,"fields":[{"name":"dealId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Cancel","header":764504475,"fields":[{"name":"dealId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Resolve","header":87817835,"fields":[{"name":"dealId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"sellerBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}}]},
    {"name":"DealInfo","header":null,"fields":[{"name":"dealId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"seller","type":{"kind":"simple","type":"address","optional":false}},{"name":"arbiter","type":{"kind":"simple","type":"address","optional":false}},{"name":"platform","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"feeBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"state","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
    {"name":"Escrow$Data","header":null,"fields":[{"name":"dealId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"seller","type":{"kind":"simple","type":"address","optional":false}},{"name":"arbiter","type":{"kind":"simple","type":"address","optional":false}},{"name":"platform","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":"coins"}},{"name":"feeBps","type":{"kind":"simple","type":"uint","optional":false,"format":16}},{"name":"state","type":{"kind":"simple","type":"uint","optional":false,"format":8}}]},
]

const Escrow_opcodes = {
    "Deploy": 2490013878,
    "DeployOk": 2952335191,
    "FactoryDeploy": 1829761339,
    "Confirm": 464539961,
    "Cancel": 764504475,
    "Resolve": 87817835,
}

const Escrow_getters: ABIGetter[] = [
    {"name":"dealInfo","methodId":123235,"arguments":[],"returnType":{"kind":"simple","type":"DealInfo","optional":false}},
]

export const Escrow_getterMapping: { [key: string]: string } = {
    'dealInfo': 'getDealInfo',
}

const Escrow_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"empty"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Confirm"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Cancel"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Resolve"}},
    {"receiver":"internal","message":{"kind":"typed","type":"Deploy"}},
]

export const STATE_CREATED = 0n;
export const STATE_FUNDED = 1n;
export const STATE_COMPLETED = 2n;
export const STATE_CANCELLED = 3n;
export const STATE_RESOLVED = 4n;
export const STORAGE_RESERVE = 10000000n;
export const BUYER_PAYS_FEE_FLAG = 32768n;

export class Escrow implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = Escrow_errors_backward;
    public static readonly opcodes = Escrow_opcodes;
    
    static async init(dealId: bigint, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: bigint, feeBps: bigint) {
        return await Escrow_init(dealId, buyer, seller, arbiter, platform, amount, feeBps);
    }
    
    static async fromInit(dealId: bigint, buyer: Address, seller: Address, arbiter: Address, platform: Address, amount: bigint, feeBps: bigint) {
        const __gen_init = await Escrow_init(dealId, buyer, seller, arbiter, platform, amount, feeBps);
        const address = contractAddress(0, __gen_init);
        return new Escrow(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new Escrow(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  Escrow_types,
        getters: Escrow_getters,
        receivers: Escrow_receivers,
        errors: Escrow_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: null | Confirm | Cancel | Resolve | Deploy) {
        
        let body: Cell | null = null;
        if (message === null) {
            body = new Cell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Confirm') {
            body = beginCell().store(storeConfirm(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Cancel') {
            body = beginCell().store(storeCancel(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Resolve') {
            body = beginCell().store(storeResolve(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'Deploy') {
            body = beginCell().store(storeDeploy(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
    async getDealInfo(provider: ContractProvider) {
        const builder = new TupleBuilder();
        const source = (await provider.get('dealInfo', builder.build())).stack;
        const result = loadGetterTupleDealInfo(source);
        return result;
    }
    
}