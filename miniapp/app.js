(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  const view = document.getElementById("view");
  const toast = document.getElementById("toast");
  const modal = document.getElementById("modal");
  const walletPill = document.getElementById("wallet-pill");
  let state = { user: null, config: null, deals: [], admin: null, route: "home", selectedDeal: null };
  let tonConnectUI = null;
  let backgroundSyncTimer = null;
  let keyboardFocus = false;

  function syncKeyboardState() {
    const viewport = window.visualViewport;
    const keyboardByViewport = viewport ? window.innerHeight - viewport.height > 140 : false;
    const mobileInput = /android|ios/i.test(tg?.platform || "") || window.matchMedia?.("(pointer: coarse)")?.matches;
    document.body.classList.toggle("keyboard-open", keyboardByViewport || (keyboardFocus && mobileInput));
  }

  document.addEventListener("focusin", (event) => {
    const target = event.target;
    keyboardFocus = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    syncKeyboardState();
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const active = document.activeElement;
      keyboardFocus = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      syncKeyboardState();
    }, 80);
  });
  window.visualViewport?.addEventListener("resize", syncKeyboardState);
  window.visualViewport?.addEventListener("scroll", syncKeyboardState);

  document.addEventListener("pointerdown", (event) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, [data-keep-keyboard]")) return;
    active.blur();
  }, { passive: true });

  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor("#ffffff");
    tg.setBackgroundColor("#f5f9fe");
    tg.enableClosingConfirmation();
  }

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const short = (value, left = 6, right = 5) => value ? `${value.slice(0, left)}…${value.slice(-right)}` : "Не указан";
  const formatDate = (seconds) => new Intl.DateTimeFormat("ru", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(seconds * 1000));

  // Fill these in once the documents are published (Telegraph links).
  // While a link is empty the footer shows a "coming soon" placeholder.
  const LEGAL_LINKS = { privacy: "", terms: "" };
  const COMMUNITY = [
    { user: "ob6ra", label: "Канал" },
    { user: "obrasdeals", label: "Чат ОТС и сделок" },
    { user: "testsuggest_bot", label: "Агент для канала" },
  ];
  const START_YEAR = 2026;

  async function copyText(text, message = "Скопировано") {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard api");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      area.remove();
    }
    tg?.HapticFeedback?.impactOccurred?.("light");
    showToast(message);
  }

  // TON amount string -> nanotons (BigInt) or null; mirrors the server parser.
  function toUnits(input) {
    const normalized = String(input || "").trim().replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
    const [whole, fraction = ""] = normalized.split(".");
    if (fraction.length > 9) return null;
    return BigInt(whole) * 1000000000n + BigInt((fraction + "000000000").slice(0, 9));
  }
  function fromUnits(units) {
    const base = 1000000000n;
    const fraction = (units % base).toString().padStart(9, "0").replace(/0+$/, "");
    return fraction ? `${units / base}.${fraction}` : String(units / base);
  }
  function feeSchedule() {
    return Array.isArray(state.config?.feeSchedule) && state.config.feeSchedule.length
      ? state.config.feeSchedule
      : [
          { key: "lt2", title: "Сделки меньше 2 TON", shortLabel: "до 2 TON", minTon: "0", maxTonExclusive: "2", feeBps: 200, feePercent: 2, feePercentText: "2" },
          { key: "2to10", title: "Сделки от 2 до 10 TON", shortLabel: "2–10 TON", minTon: "2", maxTonExclusive: "10", feeBps: 130, feePercent: 1.3, feePercentText: "1.3" },
          { key: "10to35", title: "Сделки от 10 до 35 TON", shortLabel: "10–35 TON", minTon: "10", maxTonExclusive: "35", feeBps: 90, feePercent: 0.9, feePercentText: "0.9" },
          { key: "35plus", title: "Сделки от 35 TON и выше", shortLabel: "от 35 TON", minTon: "35", maxTonExclusive: null, feeBps: 60, feePercent: 0.6, feePercentText: "0.6" },
        ];
  }
  function feeTierForUnits(amountUnits) {
    return feeSchedule().find((tier) => {
      const min = toUnits(tier.minTon) ?? 0n;
      const max = tier.maxTonExclusive === null ? null : toUnits(tier.maxTonExclusive);
      return amountUnits >= min && (max === null || amountUnits < max);
    }) || feeSchedule()[feeSchedule().length - 1];
  }
  function effectiveFeePercent(amountUnits) {
    const tier = feeTierForUnits(amountUnits);
    return Number(tier?.feePercent || 0);
  }
  function feePercentText(value) {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, "");
  }
  function feeRows(amountUnits, feePercent, networkFeeTon, feeFromSeller) {
    const networkFee = toUnits(networkFeeTon) ?? 0n;
    const serviceFee = (amountUnits * BigInt(Math.round(feePercent * 100))) / 10000n;
    const buyerSurcharge = (feeFromSeller ? 0n : serviceFee) + networkFee;
    const sellerPayout = amountUnits - (feeFromSeller ? serviceFee : 0n);
    return { amount: amountUnits, serviceFee, networkFee, feeFromSeller: !!feeFromSeller, sellerPayout, total: amountUnits + buyerSurcharge };
  }
  function feeTable(rows, feePercent) {
    const commissionLabel = rows.feeFromSeller
      ? `Комиссия платформы ${feePercentText(feePercent)}% (удержится из выплаты продавцу)`
      : `Комиссия платформы ${feePercentText(feePercent)}% (сверху к оплате покупателя)`;
    return `<dl class="fee-table"><div><dt>Продавец получит</dt><dd>${esc(fromUnits(rows.sellerPayout))} TON</dd></div><div><dt>${commissionLabel}</dt><dd>${esc(fromUnits(rows.serviceFee))} TON</dd></div><div><dt>Сетевой сбор TON (газ)</dt><dd>${esc(fromUnits(rows.networkFee))} TON</dd></div><div class="fee-total"><dt>Покупатель платит</dt><dd>${esc(fromUnits(rows.total))} TON</dd></div></dl>`;
  }
  function priceTierRows() {
    return feeSchedule().map((tier) => `<tr data-tier-key="${esc(tier.key)}"><td>${esc(tier.shortLabel)}</td><td><strong>${esc(tier.feePercentText)}%</strong></td></tr>`).join("");
  }
  function calculatorVariants(units) {
    const tier = feeTierForUnits(units);
    const feePercent = Number(tier.feePercent || 0);
    const buyerRows = feeRows(units, feePercent, state.config.networkFeeTon, false);
    const sellerRows = feeRows(units, feePercent, state.config.networkFeeTon, true);
    const buyerExtra = buyerRows.total - units;
    return `<div class="calc-brief">
      <p><b>${esc(tier.feePercentText)}%</b> комиссия платформы · <b>${esc(state.config.networkFeeTon)} TON</b> газ</p>
      <div class="calc-result-row"><div><span>Покупатель платит сверху</span><strong>${esc(fromUnits(buyerRows.total))} TON</strong></div><em>+${esc(fromUnits(buyerExtra))} TON</em></div>
      <div class="calc-result-row"><div><span>Комиссия из выплаты продавцу</span><strong>${esc(fromUnits(sellerRows.total))} TON покупатель · ${esc(fromUnits(sellerRows.sellerPayout))} TON продавец</strong></div><em>−${esc(fromUnits(sellerRows.serviceFee))} TON</em></div>
    </div>`;
  }
  function quickPricingSection() {
    return `<section class="pricing-section" id="pricing">
      <div class="section-head"><h2>Комиссия</h2></div>
      <p class="pricing-lead">Процент зависит только от суммы сделки: чем выше сумма, тем ниже ставка. При оплате добавляется сетевой резерв <b>${esc(state.config.networkFeeTon)} TON</b> на deploy и работу escrow. Финальное подтверждение покупатель подписывает отдельной on-chain транзакцией кошелька.</p>
      <div class="fee-grid-wrap">
        <table class="fee-grid-table" aria-label="Сетка комиссии платформы"><thead><tr><th>Сумма сделки</th><th>Комиссия платформы</th></tr></thead><tbody>${priceTierRows()}</tbody></table>
      </div>
      <div class="pricing-explain">
        <div><span class="prose-label">ПЛАТФОРМА</span><h3>Зачем сервису комиссия</h3><p>Она покрывает техническую работу сервиса: хостинг, RPC, Mini App, мониторинг блокчейна, поддержку и развитие — а не только работу администраторов.</p></div>
        <div><span class="prose-label">СЕТЬ TON</span><h3>Почему ещё есть ${esc(state.config.networkFeeTon)} TON</h3><p>Это резерв на on-chain действия. Первый deploy оплачивается прямо транзакцией покупателя, а не служебным кошельком. После завершения неиспользованный остаток резерва возвращается служебному кошельку и используется для редких арбитражных операций.</p><a class="text-link" href="${esc(state.config.gasInfoUrl || "https://docs.ton.org/contracts/techniques/gas")}" target="_blank" rel="noopener">Как устроен gas в TON <span>→</span></a></div>
      </div>
      <div class="fee-calculator">
        <div class="calculator-heading"><div><span class="prose-label">КАЛЬКУЛЯТОР</span><h3>Сколько получится по вашей сумме</h3></div></div>
        <p class="calculator-help">Введите сумму сделки. Покажем только итог и размер надбавки/удержания.</p>
        <div class="calculator-input-row"><div class="field calculator-field"><label for="quick-fee-amount">Сумма в TON</label><input id="quick-fee-amount" inputmode="decimal" enterkeyhint="done" placeholder="Например, 4.5"></div><button type="button" class="text-button keyboard-done" data-dismiss-keyboard>Готово</button></div>
        <div id="quick-fee-calc" class="fee-calc compact" aria-live="polite"><p class="fee-empty">Введите сумму для расчёта.</p></div>
      </div>
    </section>`;
  }


  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-telegram-init-data": tg?.initData || "",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({ error: "Сервер вернул некорректный ответ" }));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function showModal(title, text, confirmText, onConfirm, danger = false) {
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-card"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="button-row"><button id="modal-confirm" class="btn ${danger ? "btn-danger" : "btn-primary"}">${esc(confirmText)}</button><button id="modal-close" class="btn">Вернуться</button></div></div>`;
    document.getElementById("modal-close").onclick = () => { modal.hidden = true; };
    document.getElementById("modal-confirm").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try { await onConfirm(); modal.hidden = true; } catch (error) { showToast(error.message); event.currentTarget.disabled = false; }
    };
  }

  function setRoute(route) {
    state.route = route;
    document.querySelectorAll("[data-route]").forEach((item) => item.classList.toggle("active", item.dataset.route === route));
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHomeAnchor(anchor) {
    const scroll = () => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (state.route !== "home") {
      state.route = "home";
      render();
      requestAnimationFrame(() => requestAnimationFrame(scroll));
    } else scroll();
  }

  function siteMapMarkup(className = "site-map") {
    return `<nav class="${className}" aria-label="Карта сайта">
      <button data-route="home">Главная</button><button data-route="deals">Сделки</button><button data-route="create">Создать</button><button data-route="transparency">On-chain</button><button data-route="profile">Профиль</button>
      <span aria-hidden="true"></span>
      <button data-home-anchor="trust">О безопасности</button><button data-home-anchor="how-it-works">Как работает</button><button data-home-anchor="journey">Этапы сделки</button><button data-home-anchor="active-deals">Активные</button><button data-home-anchor="public-deals">Реестр</button><button data-home-anchor="pricing">Калькулятор</button>
    </nav>`;
  }

  function dealCard(deal) {
    return `<button class="deal-card" data-deal="${deal.id}"><div class="deal-card-top"><h3>Сделка #${deal.id}</h3><span class="badge ${deal.status}">${esc(deal.statusLabel)}</span></div><p>${esc(deal.description)}</p><div class="deal-meta"><span class="amount">${esc(deal.amountTon)} TON</span><span>${deal.role === "buyer" ? "Покупатель" : deal.role === "seller" ? "Продавец" : "Админ"} · ${formatDate(deal.updatedAt)}</span></div></button>`;
  }

  // Editorial (frameless) list: big thin numerals, hairline rules.
  const editorial = (items) => `<ol class="ed-list">${items.map((item, index) => `<li class="ed-item"><span class="ed-no">${String(index + 1).padStart(2, "0")}</span><div><h3>${esc(item[0])}</h3><p>${esc(item[1])}</p></div></li>`).join("")}</ol>`;
  const prose = (label, title, text) => `<section class="prose"><span class="prose-label">${esc(label)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></section>`;

  const JOURNEY = [
    { n: "01", glyph: "＋", title: "Создайте", text: "Укажите роль, сумму и условия сделки." },
    { n: "02", glyph: "→", title: "Пригласите", text: "Отправьте одноразовую ссылку второй стороне." },
    { n: "03", glyph: "ton", title: "Оплатите", text: "TON поступят в отдельный смарт-контракт." },
    { n: "04", glyph: "✓", title: "Завершите", text: "Подтвердите получение — продавец получит выплату." },
  ];
  let journeyStep = 0;
  let journeyTouched = 0;

  function tonGlyph() {
    return `<svg viewBox="0 0 40 40" width="1em" height="1em" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.5 13.5h17c1.6 0 2.6 1.7 1.8 3.1l-8.5 14.7c-.8 1.3-2.6 1.3-3.4 0l-8.5-14.7c-.8-1.4.2-3.1 1.8-3.1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M20 13.5v18.4M11.9 16.8h16.2" stroke="currentColor" stroke-width="2"/></svg>`;
  }

  function sectionDivider() {
    return `<div class="section-divider" aria-hidden="true"><span class="rail"></span><i></i></div>`;
  }
  function journeyMap() {
    return `<section id="journey" class="jmap" aria-label="Сценарий сделки"><div class="jmap-head"><div><span>СЦЕНАРИЙ СДЕЛКИ</span><h2>От условий<br>до выплаты</h2></div><span class="journey-code">TON / 04</span></div>
      <div class="jmap-stage"><div class="jmap-rail" aria-hidden="true"><i></i></div><div class="jmap-track">${JOURNEY.map((step, index) => `<button type="button" class="jcap${index === journeyStep ? " is-active" : ""}${index < journeyStep ? " is-done" : ""}" data-jstep="${index}" style="--i:${index}" aria-label="Шаг ${step.n}: ${esc(step.title)}"><i class="jcap-bg${step.glyph === "ton" ? " jcap-bg-ton" : ""}" aria-hidden="true">${step.glyph === "ton" ? tonGlyph() : step.glyph}</i><span class="jcap-num">${step.n}</span><span class="jcap-vt">${esc(step.title)}</span><span class="jcap-body"><strong>${esc(step.title)}</strong><em>${esc(step.text)}</em></span><span class="jcap-fill" aria-hidden="true"></span></button>`).join("")}</div></div></section>`;
  }

  function setJourneyStep(index, manual = false) {
    journeyStep = index;
    if (manual) journeyTouched = Date.now();
    document.querySelectorAll(".jcap").forEach((cap, k) => {
      cap.classList.toggle("is-active", k === index);
      cap.classList.toggle("is-done", k < index);
    });
  }

  setInterval(() => {
    if (document.hidden || !document.querySelector(".jmap") || Date.now() - journeyTouched < 9000) return;
    setJourneyStep((journeyStep + 1) % JOURNEY.length);
  }, 5400);

  function siteFooter() {
    const year = new Date().getFullYear();
    const years = year > START_YEAR ? `${START_YEAR}–${year}` : String(START_YEAR);
    const support = state.config?.supportUsername || "admssupport_bot";
    const legal = (key, label) => LEGAL_LINKS[key] ? `<a href="${esc(LEGAL_LINKS[key])}" target="_blank" rel="noopener">${label}</a>` : `<span class="soon">${label} · скоро</span>`;
    return `<div class="footer-inner">
      <div class="footer-top"><div class="footer-col"><h4>Поддержка</h4><a data-tg href="https://t.me/${esc(support)}">@${esc(support)}</a></div>
      <div class="footer-col"><h4>Проект</h4>${COMMUNITY.map((item) => `<a data-tg href="https://t.me/${esc(item.user)}">${esc(item.label)} <span>@${esc(item.user)}</span></a>`).join("")}</div></div>
      ${siteMapMarkup("footer-map")}
      <div class="footer-legal">${legal("privacy", "Политика конфиденциальности")}${legal("terms", "Пользовательское соглашение")}</div>
      <p class="footer-copy"><img class="brand-logo" src="/miniapp/logo-mark.png" alt="" width="16" height="16" /> © ${years} OBRA GUARANT · Escrow на TON · ${esc(state.config?.network || "mainnet")}</p>
      <p class="footer-verified">${state.config?.verifierUrl ? `Код контракта проверен на <a href="${esc(state.config.verifierUrl)}" target="_blank" rel="noopener">verifier.ton.org</a>` : "Новая версия контракта ожидает повторной публикации в TON Verifier"}</p>
    </div>`;
  }

  function renderFooter() {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    footer.innerHTML = siteFooter();
    footer.querySelectorAll("[data-route]").forEach((item) => item.onclick = () => setRoute(item.dataset.route));
    footer.querySelectorAll("[data-home-anchor]").forEach((item) => item.onclick = () => goHomeAnchor(item.dataset.homeAnchor));
    footer.querySelectorAll("a[data-tg]").forEach((link) => link.onclick = (event) => {
      if (tg?.openTelegramLink) { event.preventDefault(); tg.openTelegramLink(link.href); }
    });
  }

  function homeView() {
    const active = state.deals.filter((deal) => !["completed", "cancelled", "resolved"].includes(deal.status));
    const completed = state.deals.filter((deal) => ["completed", "resolved"].includes(deal.status));
    return `<section class="hero-open"><img class="hero-mark" src="/miniapp/logo-mark.png" alt="" aria-hidden="true" width="56" height="56" /><p class="hero-eyebrow">TON · SMART CONTRACT ESCROW</p><h1>Безопасные<br>сделки в TON</h1><p>Деньги хранятся в отдельном смарт-контракте сделки и выпускаются только по её правилам.</p><div class="hero-actions"><button class="btn btn-primary" data-route="create">Создать сделку</button><button class="btn btn-secondary" data-anchor="trust">Боюсь, что скам</button></div>${siteMapMarkup("hero-site-map")}</section>
      <div class="stats home-stats">
        <article class="stat stat-primary"><div class="stat-top"><span class="stat-index">01</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong data-count="${active.length}">${active.length}</strong><span class="stat-label">Активные<br>сделки</span><i class="stat-orbit"></i></article>
        <article class="stat stat-solid"><div class="stat-top"><span class="stat-index">02</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong data-count="${completed.length}">${completed.length}</strong><span class="stat-label">Завершено<br>успешно</span><i class="stat-grid"></i></article>
        <article class="stat stat-light"><div class="stat-top"><span class="stat-index">03</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong>0.6–2%</strong><span class="stat-label">Комиссия платформы<br>по сетке</span><i class="stat-cross">＋</i></article>
      </div>
      ${trustSection()}
      ${sectionDivider()}
      ${howItWorksSection()}
      ${sectionDivider()}
      ${journeyMap()}
      ${sectionDivider()}
      <section id="active-deals"><div class="section-head"><h2>Активные сделки</h2><button class="text-button" data-route="deals">Показать все</button></div>
      <div class="card-list">${active.length ? active.slice(0, 3).map(dealCard).join("") : `<div class="empty">Активных сделок пока нет.<br><br><button class="btn btn-primary" data-route="create">Создать первую</button></div>`}</div></section>
      ${sectionDivider()}
      ${publicDealsSection()}
      ${sectionDivider()}
      ${quickPricingSection()}`;
  }

  // ============ Trust ("почему я должен верить?") section ============
  // Shown on the home page (anchor #trust, target of the "Боюсь, что скам"
  // hero button) and referenced again, shorter, on the on-chain page.
  function trustSection() {
    const service = state.config.serviceAddress;
    const explorers = service ? {
      tonviewer: `https://${state.config.network === "testnet" ? "testnet.tonviewer.com" : "tonviewer.com"}/${service}`,
      tonscan: `https://${state.config.network === "testnet" ? "testnet.tonscan.org" : "tonscan.org"}/address/${service}`,
    } : null;
    return `<section id="trust" class="trust-section">
      <div class="section-head"><h2>Почему это прозрачно</h2></div>
      ${editorial([
        ["Отдельный контракт", "Каждая сделка получает собственный on-chain адрес — деньги никогда не лежат на кошельке бота."],
        ["Фиксированные стороны", "Адреса покупателя, продавца и комиссий записаны в контракт при создании и не могут быть подменены."],
        ["Проверяемо вручную", "Баланс и вся история операций служебного кошелька открыты в Tonviewer и Tonscan — ссылки ниже."],
        ["Арбитраж, а не бот", "После оплаты спор решается только в пользу покупателя или продавца — вывести средства куда-то ещё контракт не позволяет."],
      ])}
      <div class="trust-grid">
        <div class="trust-card">
          <h3>Служебный кошелёк вживую</h3>
          <p>Этот кошелёк больше не нужен для запуска обычной сделки: deploy и пополнение escrow делает сам покупатель одной транзакцией. Служебный кошелёк остаётся арбитражным резервом для споров и аварийных действий; комиссия платформы уходит на отдельный адрес.</p>
          ${explorers ? `<div class="link-list"><a href="${esc(explorers.tonviewer)}" target="_blank" rel="noopener">Открыть в Tonviewer ↗</a><a href="${esc(explorers.tonscan)}" target="_blank" rel="noopener">Открыть в Tonscan ↗</a></div>` : ""}
        </div>
        <details class="trust-card trust-verifier">
          <summary><h3>${state.config.verifierUrl ? "Код контракта опубликован в TON Verifier" : "Проверка кода новой версии"}</h3><span class="chev" aria-hidden="true">▾</span></summary>
          <div class="trust-verifier-body">
            <p>После изменения логики deploy/confirm меняется bytecode и code hash контракта. Поэтому старая ссылка на верификацию больше не используется.</p>
            <p>${state.config.verifierUrl ? "Новая версия уже опубликована: можно сверить исходники с байткодом." : "Перед публичным запуском новую версию нужно отдельно опубликовать в TON Verifier; текущий hash всегда показан в разделе On-chain."}</p>
            ${state.config.verifierUrl ? `<a class="text-link" href="${esc(state.config.verifierUrl)}" target="_blank" rel="noopener">Открыть проверку на verifier.ton.org <span>→</span></a>` : ""}
          </div>
        </details>
      </div>
      <p class="trust-note">Минимальная сумма сделки — всего ${esc(state.config.minDealTon)} TON: прежде чем доверять большую сумму, можно провести тестовую сделку и лично убедиться, как это работает.</p>
    </section>`;
  }

  function howItWorksSection() {
    return `<section id="how-it-works" class="how-it-works">
      <div class="section-head"><h2>Как это работает</h2></div>
      <p class="page-intro">Если вы не погружены в блокчейн, достаточно помнить одну вещь: бот помогает сторонам договориться и следит за статусом, а деньги удерживает не бот и не админ — их держит отдельный смарт-контракт конкретной сделки.</p>
      <ol class="simple-guide">
        <li><span>01</span><div><h3>Создаёте условия</h3><p>Указываете сумму, что покупаете или продаёте, и приглашаете вторую сторону. Обе стороны привязывают свои TON-кошельки.</p></div></li>
        <li><span>02</span><div><h3>Покупатель оплачивает escrow</h3><p>Кошелёк покупателя одной транзакцией создаёт контракт сделки и переводит туда нужную сумму. Деньги не проходят через кошелёк бота.</p></div></li>
        <li><span>03</span><div><h3>Продавец выполняет условия</h3><p>После подтверждения оплаты продавец передаёт товар или оказывает услугу. До этого момента переводить что-либо вне escrow не нужно.</p></div></li>
        <li><span>04</span><div><h3>Подтверждение или спор</h3><p>Если всё хорошо, покупатель подтверждает получение своим кошельком и контракт платит продавцу. Если есть проблема — открывается спор, а арбитр может распределить деньги только между сторонами.</p></div></li>
      </ol>
      <p class="simple-guide-note"><b>Коротко:</b> договорились → покупатель внёс TON в контракт → продавец выполнил условия → покупатель подтвердил → контракт выплатил деньги.</p>
      <button class="text-button guide-cta" data-route="create">Создать первую сделку →</button>
    </section>`;
  }

  // ============ Public deal history: every deal, bot- or app-created ============
  let publicDealsCache = null;
  let publicDealsOpen = false;

  function publicDealCard(deal) {
    const parties = [
      deal.buyerUsername ? `Покупатель @${esc(deal.buyerUsername)}` : null,
      deal.sellerUsername ? `Продавец @${esc(deal.sellerUsername)}` : null,
    ].filter(Boolean).join(" · ") || "Стороны не раскрыли контакты";
    return `<article class="pd-card">
      <div class="pd-top"><span class="badge ${esc(deal.status)}">${esc(deal.statusLabel)}</span><span class="pd-amount">${esc(deal.amountTon)} TON</span></div>
      <p class="pd-desc">${esc(deal.description)}</p>
      <p class="pd-parties">${parties}</p>
      <div class="pd-meta"><span>#${deal.id} · ${formatDate(deal.updatedAt)}</span>${deal.explorers ? `<span class="link-list inline"><a href="${esc(deal.explorers.tonviewer)}" target="_blank" rel="noopener">Tonviewer ↗</a><a href="${esc(deal.explorers.tonscan)}" target="_blank" rel="noopener">Tonscan ↗</a></span>` : ""}</div>
    </article>`;
  }

  function publicDealsSection() {
    return `<section id="public-deals" class="section-head-wrap">
      <div class="section-head"><h2>Реестр всех сделок</h2></div>
      <p class="page-intro">Публичная история — сюда попадают все сделки, оформленные и в мини-аппе, и в чате с ботом. Раскройте, чтобы посмотреть карточку любой сделки со ссылками на блокчейн-обозреватели.</p>
      <details class="pd-wrap" id="pd-details">
        <summary class="pd-summary"><span>Показать реестр${publicDealsCache ? ` (${publicDealsCache.total})` : ""}</span><span class="chev" aria-hidden="true">▾</span></summary>
        <div id="pd-list" class="pd-list">${publicDealsCache ? renderPublicDealsList(publicDealsCache.deals) : `<div class="loading-screen" style="min-height:120px"><div class="loader"></div></div>`}</div>
      </details>
    </section>`;
  }

  function renderPublicDealsList(deals) {
    if (!deals.length) return `<div class="empty">Пока нет завершённых сделок с раскрытой историей.</div>`;
    return deals.map(publicDealCard).join("");
  }

  async function loadPublicDeals() {
    if (publicDealsCache) return;
    try {
      const data = await api("/api/public-deals?limit=100");
      publicDealsCache = data;
      document.querySelectorAll("#pd-list").forEach((el) => { el.innerHTML = renderPublicDealsList(data.deals); });
      document.querySelectorAll(".pd-summary span:first-child").forEach((el) => { el.textContent = publicDealsOpen ? `Скрыть реестр (${data.total})` : `Показать реестр (${data.total})`; });
    } catch (error) {
      document.querySelectorAll("#pd-list").forEach((el) => { el.innerHTML = `<div class="error-box">${esc(error.message)}</div>`; });
    }
  }

  function dealsView() {
    return `<h1 class="page-title">Мои сделки</h1><p class="page-intro">Все созданные и принятые вами сделки. Статус контракта обновится при открытии карточки.</p><div class="card-list deal-grid">${state.deals.length ? state.deals.map(dealCard).join("") : `<div class="empty">Список пуст</div>`}</div>`;
  }

  function createView() {
    return `<h1 class="page-title">Новая сделка</h1><p class="page-intro">Укажите условия. После создания отправьте одноразовую ссылку второй стороне.</p><form id="create-form" class="panel panel-blueprint">
      <div class="field"><label>Ваша роль</label><div class="segmented"><label><input type="radio" name="role" value="buyer" checked><span>Я покупатель</span></label><label><input type="radio" name="role" value="seller"><span>Я продавец</span></label></div></div>
      <div class="field"><label for="counterparty">Username второй стороны</label><input id="counterparty" name="counterparty" placeholder="@username (необязательно)" autocomplete="off"></div>
      <div class="field"><label for="amount">Сумма сделки в TON</label><input id="amount" name="amount" inputmode="decimal" placeholder="0,01" required></div><p class="hint">Лимит: ${esc(state.config.minDealTon)}–${esc(state.config.maxDealTon)} TON.</p>
      <div id="fee-payer-field" class="field" hidden><label>Кто платит комиссию платформы? Газ ${esc(state.config.networkFeeTon)} TON учитывается отдельно.</label><div class="segmented"><label><input type="radio" name="feePayer" value="buyer" checked><span>Покупатель сверху</span></label><label><input type="radio" name="feePayer" value="seller"><span>Из суммы продавца</span></label></div></div><div id="fee-calc" class="fee-calc" aria-live="polite"></div>
      <div class="field"><label for="description">Товар, услуга и условия передачи</label><textarea id="description" name="description" maxlength="1000" placeholder="Опишите предмет сделки так, чтобы обеим сторонам были понятны условия" required></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Создать и получить приглашение</button></form>`;
  }

  function profileView() {
    return `<h1 class="page-title">Профиль</h1><p class="page-intro">TON-адрес используется как адрес покупателя или получателя выплаты. Seed-фраза боту не нужна.</p><form id="wallet-form" class="panel panel-blueprint"><h2>Кошелёк</h2><div class="field"><label for="wallet-address">Ваш TON-адрес</label><input id="wallet-address" name="address" value="${esc(state.user.walletAddress || "")}" placeholder="EQ… или UQ…" required></div><button class="btn btn-primary btn-block">Сохранить адрес</button></form>
      <section class="plain"><span class="prose-label">АККАУНТ</span><h3>Telegram</h3><dl class="kv kv-plain"><dt>Имя</dt><dd>${esc([state.user.first_name, state.user.last_name].filter(Boolean).join(" "))}</dd><dt>Username</dt><dd>${state.user.username ? "@" + esc(state.user.username) : "не задан"}</dd><dt>Telegram ID</dt><dd>${state.user.id}</dd><dt>Доступ</dt><dd><span class="access-badge ${state.user.isAdmin ? "admin" : "user"}">${state.user.isAdmin ? "Администратор" : "Пользователь"}</span></dd><dt>Сеть</dt><dd>${esc(state.config.network)}</dd></dl>${state.user.isAdmin ? `<button class="btn btn-primary btn-block" data-route="admin">Открыть админ-панель</button>` : `<p class="hint admin-hint">Если здесь должен быть статус администратора, сравните Telegram ID выше со значением ARBITER_TG_IDS в Railway.</p>`}</section>
      <section class="prose help-prose"><span class="prose-label">ПОДДЕРЖКА</span><h3>Нужна помощь?</h3><p>Не сообщайте никому seed-фразу. При проблеме со сделкой после оплаты откройте спор и напишите нам.</p><a class="text-link" href="https://t.me/${encodeURIComponent(state.config.supportUsername)}">Написать @${esc(state.config.supportUsername)} <span>→</span></a></section>`;
  }

  function transparencyView() {
    return `<h1 class="page-title">On-chain прозрачность</h1><p class="page-intro">Данные можно самостоятельно проверить в блокчейне TON.</p><div id="transparency-data" class="panel panel-blueprint"><div class="loading-screen" style="min-height:220px"><div class="loader"></div><p>Читаем блокчейн…</p></div></div>
      <div class="ghost-wrap"><span class="ghost-word" aria-hidden="true">on-chain</span>${editorial([["Депозит не на кошельке бота", "Средства находятся на отдельном escrow-контракте сделки."], ["Получатели неизменяемы", "Контракт не позволяет арбитру подставить произвольный адрес."], ["Комиссии известны заранее", `Платформенная комиссия зависит от суммы сделки: до 2 TON — 2%, 2–10 TON — 1.3%, 10–35 TON — 0.9%, от 35 TON — 0.6%. Дополнительно берётся фиксированный сетевой сбор ${state.config.networkFeeTon} TON.`]])}</div>
      ${state.config.verifierUrl
        ? `${prose("ВЕРИФИКАЦИЯ", "Код новой версии опубликован", "Исходный код новой версии контракта можно сверить с её байткодом в TON Verifier.")}<a class="text-link" href="${esc(state.config.verifierUrl)}" target="_blank" rel="noopener">Открыть проверку на verifier.ton.org <span>→</span></a>`
        : prose("ВЕРИФИКАЦИЯ", "Новая версия ожидает повторной верификации", "После обновления архитектуры bytecode изменился. Старую ссылку не показываем; перед публичным запуском новую версию нужно опубликовать в TON Verifier.")}
      <div id="terms">${prose("ВАЖНО", "Mainnet MVP без независимого аудита", "Начинайте с небольших сумм и всегда проверяйте адрес перед переводом. Код контракта можно сверить по hash выше.")}</div>
      <div id="privacy">${prose("КОНФИДЕНЦИАЛЬНОСТЬ", "Что мы храним", "Telegram ID, username, указанный TON-адрес и данные сделки. Seed-фразы не запрашиваются и не сохраняются.")}</div>
      ${publicDealsSection()}`;
  }

  function adminView() {
    if (!state.user.isAdmin) return `<div class="error-box">Нет доступа</div>`;
    const stats = state.admin.stats;
    return `<h1 class="page-title">Админ-панель</h1><p class="page-intro">Контроль активных сделок и споров. Blockchain-действия необратимы.</p><div class="stats home-stats admin-stats"><article class="stat stat-primary"><div class="stat-top"><span class="stat-index">01</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong>${stats.users}</strong><span class="stat-label">Пользова-<br>телей</span><i class="stat-orbit"></i></article><article class="stat stat-solid"><div class="stat-top"><span class="stat-index">02</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong>${stats.active}</strong><span class="stat-label">Активных<br>сделок</span><i class="stat-grid"></i></article><article class="stat stat-light"><div class="stat-top"><span class="stat-index">03</span><span class="stat-signal"><b></b><b></b><b></b></span></div><strong>${stats.disputed}</strong><span class="stat-label">Открытых<br>споров</span><i class="stat-cross">＋</i></article></div><div class="section-head"><h2>Последние сделки</h2></div><div class="card-list">${state.admin.recent.map(dealCard).join("") || `<div class="empty">Сделок нет</div>`}</div>`;
  }

  const stages = [
    ["draft", "Участники присоединяются"], ["awaiting_wallets", "Адреса кошельков"], ["deployed", "Оплата в escrow"], ["funded", "Передача и подтверждение"], ["completed", "Выплата продавцу"],
  ];

  function nextStepForDeal(deal) {
    if (deal.role === "admin") {
      if (deal.status === "disputed") return { tone: "warning", label: "ТРЕБУЕТСЯ РЕШЕНИЕ", title: "Рассмотрите открытый спор", text: "Проверьте доказательства обеих сторон и выберите возврат либо распределение средств." };
      return { tone: "calm", label: "РЕЖИМ АРБИТРА", title: "Следите за состоянием сделки", text: "Действия арбитра появятся ниже, когда они будут допустимы контрактом." };
    }
    if (!state.user.walletAddress && ["draft", "awaiting_wallets"].includes(deal.status)) {
      return { tone: "attention", label: "ШАГ 01 · КОШЕЛЁК", title: "Сохраните свой TON-адрес", text: "Без адресов покупателя и продавца escrow-контракт не будет создан.", action: `<button class="btn btn-primary btn-block" data-route="profile">Добавить кошелёк</button>` };
    }
    if (deal.status === "draft") {
      return { tone: "attention", label: "ШАГ 02 · УЧАСТНИК", title: "Пригласите вторую сторону", text: "Отправьте одноразовую ссылку покупателю или продавцу. После присоединения бот продолжит сделку автоматически.", action: deal.inviteToken ? `<button class="btn btn-primary btn-block" data-action="share">Поделиться приглашением</button>` : "" };
    }
    if (deal.status === "awaiting_wallets") {
      return { tone: "calm", label: "ШАГ 02 · АДРЕСА", title: "Ожидаем кошелёк второй стороны", text: "Ваш адрес сохранён. Контракт развернётся автоматически, когда второй участник укажет свой TON-адрес." };
    }
    if (deal.status === "setup_pending") {
      return { tone: "progress", label: "ШАГ 03 · BLOCKCHAIN", title: "Готовим escrow-адрес", text: "Сервис вычисляет будущий адрес контракта. Сам deploy произойдёт только вместе с оплатой покупателя — служебный кошелёк для этого не используется." };
    }
    if (deal.status === "deployed" && deal.role === "buyer") {
      const breakdown = deal.fees.feeFromSeller
        ? `Сумма сделки ${deal.amountTon} TON + сетевой резерв ${deal.fees.networkFeeTon} TON (комиссия платформы ${deal.fees.serviceFeeTon} TON удержится из выплаты продавцу).`
        : `Сумма сделки ${deal.amountTon} TON + комиссия платформы ${deal.fees.serviceFeeTon} TON + сетевой резерв ${deal.fees.networkFeeTon} TON.`;
      return { tone: "attention", label: "ШАГ 03 · ОПЛАТА", title: `Внесите ${deal.fees.totalTon} TON в escrow`, text: `${breakdown} Используйте кнопку ниже: сумма и адрес контракта будут подставлены автоматически.`, action: `<button class="btn btn-primary btn-block" data-action="pay">Оплатить ${esc(deal.fees.totalTon)} TON</button>` };
    }
    if (deal.status === "deployed") {
      return { tone: "calm", label: "ШАГ 03 · ОЖИДАНИЕ", title: "Покупатель ещё не оплатил", text: "Не передавайте товар или услугу, пока статус не изменится на «Оплачено»." };
    }
    if (deal.status === "funded" && deal.role === "buyer") {
      return { tone: "success", label: "ШАГ 04 · ПОЛУЧЕНИЕ", title: "Оплата защищена контрактом", text: "Проверьте товар или услугу. Подтверждайте получение только когда всё выполнено; при проблеме откройте спор.", action: `<div class="button-row"><button class="btn btn-primary btn-block" data-action="confirm">Подтвердить получение</button><button class="btn btn-danger btn-block" data-action="dispute">Открыть спор</button></div>` };
    }
    if (deal.status === "funded") {
      return { tone: "success", label: "ШАГ 04 · ИСПОЛНЕНИЕ", title: "Оплата получена escrow-контрактом", text: "Теперь передайте покупателю товар или окажите услугу. Выплата поступит после его подтверждения." };
    }
    if (deal.status === "disputed") {
      return { tone: "warning", label: "СПОР ОТКРЫТ", title: "Выплата приостановлена", text: "Свяжитесь с поддержкой и предоставьте доказательства. Средства останутся в escrow до решения арбитра.", action: `<a class="btn btn-block" href="https://t.me/${encodeURIComponent(state.config.supportUsername)}">Написать в поддержку</a>` };
    }
    if (["confirm_pending", "cancel_pending", "resolve_pending"].includes(deal.status)) {
      return { tone: "progress", label: "ТРАНЗАКЦИЯ ОТПРАВЛЕНА", title: "Ожидаем подтверждение TON", text: "Ничего дополнительно делать не нужно. Карточка обновится автоматически после включения транзакции в блок." };
    }
    if (deal.status === "completed") return { tone: "success", label: "СДЕЛКА ЗАВЕРШЕНА", title: "Выплата отправлена продавцу", text: "Escrow-контракт завершил сделку. Операцию можно проверить в блокчейн-обозревателе ниже." };
    if (deal.status === "cancelled") return { tone: "calm", label: "СДЕЛКА ОТМЕНЕНА", title: "Сделка закрыта", text: "Если оплата успела поступить в контракт, покупателю возвращаются сумма сделки и комиссия платформы; сетевой сбор остаётся на газ." };
    if (deal.status === "resolved") return { tone: "success", label: "СПОР РАЗРЕШЁН", title: "Средства распределены", text: "Решение арбитра отправлено в блокчейн и сделка закрыта." };
    return { tone: "calm", label: "ТЕКУЩИЙ СТАТУС", title: deal.statusLabel, text: "Карточка будет обновляться автоматически." };
  }

  function consentPanel(deal) {
    const state_ = deal.myConsent;
    const status = state_ === 1 ? "Виден в публичном реестре" : state_ === 0 ? "Скрыт из публичного реестра" : "Ещё не выбрано";
    return `<div class="panel"><h3>Публичный реестр</h3><p class="page-intro">Разрешите показывать ваш @username в общедоступной истории сделок — это поможет другим пользователям убедиться в вашей репутации и при необходимости расспросить вас лично.</p>
      <p class="hint">Текущий выбор: ${esc(status)}</p>
      <div class="button-row"><button class="btn ${state_ === 1 ? "btn-primary" : ""}" data-consent="yes">Да, можно</button><button class="btn ${state_ === 0 ? "btn-primary" : ""}" data-consent="no">Нет, скрыть</button></div></div>`;
  }

  function dealView(deal) {
    const statusOrder = { draft: 0, awaiting_wallets: 1, setup_pending: 2, deployed: 2, funded: 3, disputed: 3, confirm_pending: 4, completed: 5, cancel_pending: 4, cancelled: 5, resolve_pending: 4, resolved: 5 };
    const level = statusOrder[deal.status] ?? 0;
    const canPay = deal.role === "buyer" && deal.status === "deployed" && deal.contractAddress;
    const canConfirm = deal.role === "buyer" && deal.status === "funded";
    const canDispute = ["buyer", "seller"].includes(deal.role) && deal.status === "funded";
    const canCancel = ["draft", "awaiting_wallets", "deployed"].includes(deal.status) && ["buyer", "seller"].includes(deal.role);
    const actions = [
      canPay ? `<button class="btn btn-primary btn-block" data-action="pay">Оплатить ${esc(deal.fees.totalTon)} TON</button>` : "",
      canConfirm ? `<button class="btn btn-primary btn-block" data-action="confirm">Подтвердить получение</button>` : "",
      canDispute ? `<button class="btn btn-danger btn-block" data-action="dispute">Открыть спор</button>` : "",
      canCancel ? `<button class="btn btn-danger btn-block" data-action="cancel">Отменить сделку</button>` : "",
    ].join("");
    const adminActions = state.user.isAdmin && ["deployed", "funded", "disputed"].includes(deal.status) ? `<div class="panel"><h3>Действия арбитра</h3><div class="button-row"><button class="btn btn-danger" data-action="admin_cancel">Возврат покупателю</button>${["funded", "disputed"].includes(deal.status) ? `<button class="btn" data-action="admin_resolve">Распределить средства</button>` : ""}</div></div>` : "";
    const nextStep = nextStepForDeal(deal);
    return `<button class="text-button" data-route="deals">← Все сделки</button><section class="detail-head"><span class="badge ${deal.status}">${esc(deal.statusLabel)}</span><h1>${esc(deal.amountTon)} TON</h1><p>Сделка #${deal.id} · ${deal.role === "buyer" ? "вы покупатель" : deal.role === "seller" ? "вы продавец" : "режим администратора"}</p></section>
      <section class="next-step ${nextStep.tone}"><div class="next-step-top"><span class="live-dot"></span><span>${esc(nextStep.label)}</span><small>обновляется автоматически</small></div><h2>${esc(nextStep.title)}</h2><p>${esc(nextStep.text)}</p>${nextStep.action || ""}</section>
      <div class="panel"><h3>Условия</h3><p>${esc(deal.description)}</p><dl class="kv"><dt>Покупатель</dt><dd>${deal.buyer?.username ? "@" + esc(deal.buyer.username) : deal.buyer ? `ID ${deal.buyer.id}` : "ожидается"}</dd><dt>Продавец</dt><dd>${deal.seller?.username ? "@" + esc(deal.seller.username) : deal.seller ? `ID ${deal.seller.id}` : "ожидается"}</dd><dt>Создана</dt><dd>${formatDate(deal.createdAt)}</dd></dl></div>
      <div class="panel"><h3>Расчёт по сделке</h3>${feeTable({ amount: BigInt(deal.amountUnits), serviceFee: toUnits(deal.fees.serviceFeeTon), networkFee: toUnits(deal.fees.networkFeeTon), total: BigInt(deal.fees.totalUnits), feeFromSeller: deal.fees.feeFromSeller, sellerPayout: toUnits(deal.fees.sellerPayoutTon) }, deal.fees.feePercent)}</div>
      ${deal.contractAddress ? `<div class="panel"><h3>Escrow-контракт</h3><button class="copy-value" data-copy="${esc(deal.contractAddress)}" data-copy-label="Адрес скопирован">${esc(deal.contractAddress)}</button><div class="link-list" style="margin-top:10px"><a href="${esc(deal.explorers.tonviewer)}">Открыть в Tonviewer ↗</a><a href="${esc(deal.explorers.tonscan)}">Открыть в Tonscan ↗</a></div></div>` : ""}
      ${deal.inviteToken ? `<div class="panel"><h3>Приглашение</h3><p class="page-intro">Отправьте ссылку второй стороне. Она одноразовая.</p><button class="btn btn-primary btn-block" data-action="share">Поделиться приглашением</button></div>` : ""}
      ${deal.consentEligible && deal.role !== "admin" ? consentPanel(deal) : ""}
      <div class="panel"><h3>Ход сделки</h3><ol class="timeline">${stages.map((stage, index) => `<li class="${level >= index ? "done" : ""}">${stage[1]}</li>`).join("")}</ol></div>
      ${actions ? `<div class="panel"><h3>Доступные действия</h3><div class="button-row">${actions}</div></div>` : ""}${adminActions}`;
  }

  let lastRenderKey = "";
  let lastSignature = "";

  // Entrance choreography: content rises in with a stagger, numbers count up.
  // Silent background refreshes (same screen) never replay it.
  function decorateView(animate) {
    if (!animate) return;
    const targets = [...new Set([...view.querySelectorAll(":scope > *, .card-list > *, .trust-grid > *, .stats > *")])];
    const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        element.classList.add("in");
        observer.unobserve(element);
        // Drop the entrance classes afterwards so hover/press transitions stay snappy.
        setTimeout(() => { element.classList.remove("reveal", "in"); element.style.removeProperty("--d"); }, 1500);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }) : null;
    targets.forEach((element, index) => {
      element.classList.add("reveal");
      element.style.setProperty("--d", `${Math.min(index, 7) * 70}ms`);
      if (observer) observer.observe(element); else element.classList.add("in");
    });
    view.querySelectorAll("[data-count]").forEach((element) => {
      const end = Number(element.dataset.count);
      if (!Number.isFinite(end) || end <= 0) return;
      const started = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - started) / 900);
        element.textContent = String(Math.round(end * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) requestAnimationFrame(tick);
      };
      element.textContent = "0";
      requestAnimationFrame(tick);
    });
  }

  const TAB_ROUTES = ["home", "deals", "create", "transparency", "profile"];
  function updateTabIndicator() {
    const indicator = document.querySelector(".tabbar-indicator");
    if (!indicator) return;
    const index = TAB_ROUTES.indexOf(state.route === "deal" ? "deals" : state.route);
    const onCreate = state.route === "create";
    indicator.classList.toggle("hide", index === -1 || onCreate);
    if (index !== -1) indicator.style.setProperty("--tab-index", String(index));
  }

  function render() {
    if (!state.user) return;
    const renderKey = `${state.route}:${state.route === "deal" ? state.selectedDeal?.id : ""}`;
    const animate = renderKey !== lastRenderKey;
    lastRenderKey = renderKey;
    view.classList.toggle("entering", animate);
    document.querySelectorAll("#tabbar [data-route]").forEach((item) => item.classList.toggle("active", item.dataset.route === state.route));
    updateTabIndicator();
    walletPill.textContent = state.user.walletAddress ? short(state.user.walletAddress) : "Добавить кошелёк";
    walletPill.classList.toggle("is-set", !!state.user.walletAddress);
    let html = null;
    if (state.route === "home") html = homeView();
    else if (state.route === "deals") html = dealsView();
    else if (state.route === "create") html = createView();
    else if (state.route === "profile") html = profileView();
    else if (state.route === "transparency") html = transparencyView();
    else if (state.route === "admin") html = adminView();
    else if (state.route === "deal" && state.selectedDeal) html = dealView(state.selectedDeal);
    if (html === null) return;
    // Silent refreshes with unchanged content must not touch the DOM, otherwise
    // every element would replay its animation. The journey's active step is
    // driven by a timer, so it is ignored in the comparison.
    const signature = html.replace(/ is-(?:active|done)/g, "");
    if (!animate && signature === lastSignature) return;
    lastSignature = signature;
    view.innerHTML = html;
    if (state.route === "transparency") loadTransparency();
    bindCurrentView();
    decorateView(animate);
    renderFooter();
  }

  function bindCurrentView() {
    view.querySelectorAll("[data-route]").forEach((item) => item.onclick = () => setRoute(item.dataset.route));
    view.querySelectorAll("[data-home-anchor]").forEach((item) => item.onclick = () => goHomeAnchor(item.dataset.homeAnchor));
    view.querySelectorAll("[data-anchor]").forEach((item) => item.onclick = () => {
      document.getElementById(item.dataset.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    view.querySelectorAll("[data-deal]").forEach((item) => item.onclick = () => openDeal(Number(item.dataset.deal)));
    view.querySelectorAll("[data-copy]").forEach((item) => item.onclick = () => copyText(item.dataset.copy, item.dataset.copyLabel || "Скопировано"));
    view.querySelectorAll("[data-jstep]").forEach((item) => item.onclick = () => setJourneyStep(Number(item.dataset.jstep), true));
    const amountInput = document.getElementById("amount");
    const feePayerInputs = view.querySelectorAll('input[name="feePayer"]');
    if (amountInput) {
      const update = () => {
        const target = document.getElementById("fee-calc");
        const feePayerField = document.getElementById("fee-payer-field");
        const units = toUnits(amountInput.value);
        const feePercent = units && units > 0n ? effectiveFeePercent(units) : 0;
        if (feePayerField) feePayerField.hidden = !(units && units > 0n);
        const feeFromSeller = units && units > 0n && view.querySelector('input[name="feePayer"]:checked')?.value === "seller";
        target.innerHTML = units && units > 0n ? feeTable(feeRows(units, feePercent, state.config.networkFeeTon, feeFromSeller), feePercent) : `<p class="fee-empty">Введите сумму — покажем комиссию по сетке и итоговую оплату.</p>`;
      };
      amountInput.addEventListener("input", update);
      feePayerInputs.forEach((input) => input.addEventListener("change", update));
      update();
    }
    const quickAmountInput = document.getElementById("quick-fee-amount");
    if (quickAmountInput) {
      const updateQuickCalc = () => {
        const target = document.getElementById("quick-fee-calc");
        const units = toUnits(quickAmountInput.value);
        const tier = units && units > 0n ? feeTierForUnits(units) : null;
        document.querySelectorAll(".fee-grid-table tbody tr").forEach((row) => {
          row.classList.toggle("is-active", !!tier && row.dataset.tierKey === tier.key);
        });
        target.innerHTML = units && units > 0n ? calculatorVariants(units) : `<p class="fee-empty">Введите сумму для расчёта.</p>`;
      };
      quickAmountInput.addEventListener("input", updateQuickCalc);
      quickAmountInput.addEventListener("keydown", (event) => { if (event.key === "Enter") quickAmountInput.blur(); });
      updateQuickCalc();
    }
    view.querySelectorAll("[data-dismiss-keyboard]").forEach((button) => button.onclick = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    document.getElementById("create-form")?.addEventListener("submit", createDeal);
    document.getElementById("wallet-form")?.addEventListener("submit", saveWallet);
    view.querySelectorAll("[data-action]").forEach((item) => item.onclick = () => dealAction(item.dataset.action));
    view.querySelectorAll(".pd-wrap").forEach((details) => {
      details.ontoggle = () => {
        publicDealsOpen = details.open;
        if (details.open) void loadPublicDeals();
      };
    });
    view.querySelectorAll("[data-consent]").forEach((item) => item.onclick = () => setConsent(Boolean(item.dataset.consent === "yes")));
  }

  async function refresh() {
    const data = await api("/api/bootstrap");
    state = { ...state, ...data };
    render();
  }

  let lastDataSignature = "";

  async function backgroundRefresh() {
    if (!state.user || document.hidden) return;
    try {
      const previousStatus = state.selectedDeal?.status;
      const selectedId = state.selectedDeal?.id;
      const data = await api("/api/bootstrap");
      // Nothing changed on the server: keep the DOM (and its animations) untouched.
      const signature = JSON.stringify([data.user, data.deals, data.admin]);
      if (signature === lastDataSignature) return;
      lastDataSignature = signature;
      state = { ...state, ...data };
      if (selectedId) {
        const fresh = data.deals.find((deal) => deal.id === selectedId);
        if (fresh) state.selectedDeal = { ...state.selectedDeal, ...fresh };
      }
      if (state.route !== "transparency") render();
      if (previousStatus && state.selectedDeal?.status !== previousStatus) {
        showToast(`Статус обновлён: ${state.selectedDeal.statusLabel}`);
        tg?.HapticFeedback?.notificationOccurred("success");
      }
    } catch (error) {
      console.warn("Background refresh failed", error);
    }
  }

  function startBackgroundSync() {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = setInterval(() => void backgroundRefresh(), 15_000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void backgroundRefresh();
    });
  }

  async function openDeal(id) {
    view.innerHTML = `<section class="loading-screen"><div class="loader"></div><p>Проверяем контракт…</p></section>`;
    try {
      const data = await api(`/api/deals/${id}`);
      state.selectedDeal = data.deal;
      state.route = "deal";
      render();
    } catch (error) { showToast(error.message); setRoute("deals"); }
  }

  async function createDeal(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    const form = new FormData(event.currentTarget);
    try {
      const data = await api("/api/deals", { method: "POST", body: JSON.stringify({ role: form.get("role"), counterpartyUsername: form.get("counterparty"), amountTon: String(form.get("amount")).replace(",", "."), description: form.get("description"), feeFromSeller: form.get("feePayer") === "seller" }) });
      await refresh();
      state.selectedDeal = { ...data.deal, inviteUrl: data.inviteUrl };
      state.route = "deal";
      render();
      showInvite(data.inviteUrl);
    } catch (error) { showToast(error.message); button.disabled = false; }
  }

  function showInvite(inviteUrl) {
    showModal("Сделка создана", "Отправьте одноразовую ссылку второй стороне. После присоединения оба участника должны сохранить TON-адреса.", "Поделиться", async () => {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent("Приглашение в безопасную сделку OBRA GUARANT")}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl); else window.open(shareUrl, "_blank");
    });
  }

  async function saveWallet(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const address = new FormData(event.currentTarget).get("address");
      const data = await api("/api/wallet", { method: "POST", body: JSON.stringify({ address }) });
      state.user.walletAddress = data.walletAddress;
      walletPill.textContent = short(data.walletAddress);
      walletPill.classList.add("is-set");
      showToast("Кошелёк сохранён");
      await refresh();
    } catch (error) { showToast(error.message); button.disabled = false; }
  }

  async function setConsent(consent) {
    const deal = state.selectedDeal;
    if (!deal) return;
    try {
      const data = await api(`/api/deals/${deal.id}/consent`, { method: "POST", body: JSON.stringify({ consent }) });
      state.selectedDeal = data.deal;
      showToast(consent ? "Username будет виден в реестре" : "Username скрыт из реестра");
      render();
    } catch (error) { showToast(error.message); }
  }

  async function tonConnect() {
    if (!window.TON_CONNECT_UI?.TonConnectUI) throw new Error("TON Connect не загрузился. Проверьте интернет и повторите.");
    if (!tonConnectUI) {
      tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: `${location.origin}/tonconnect-manifest.json` });
    }
    if (!tonConnectUI.connected) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Подключение кошелька не завершено")); }, 120_000);
        const unsubscribe = tonConnectUI.onStatusChange((wallet) => {
          if (!wallet) return;
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }, (error) => {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        });
        tonConnectUI.openModal().catch((error) => {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        });
      });
    }
    return tonConnectUI;
  }

  async function payDeal() {
    const deal = state.selectedDeal;
    const connector = await tonConnect();
    const account = connector.account;
    if (!account) throw new Error("Подключите TON-кошелёк");
    if (deal.buyerAddressRaw && account.address.toLowerCase() !== deal.buyerAddressRaw.toLowerCase()) throw new Error("Подключён не тот кошелёк, который указан покупателем в сделке");
    const deployment = await api(`/api/deals/${deal.id}/deployment`);
    await connector.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [{
        address: deployment.address,
        amount: deployment.amountUnits,
        stateInit: deployment.stateInit,
      }],
    });
    showToast("Транзакция отправлена: контракт развернётся и получит депозит одной операцией.");
  }

  async function confirmDealFromBuyerWallet() {
    const deal = state.selectedDeal;
    const connector = await tonConnect();
    const account = connector.account;
    if (!account) throw new Error("Подключите TON-кошелёк");
    if (deal.buyerAddressRaw && account.address.toLowerCase() !== deal.buyerAddressRaw.toLowerCase()) throw new Error("Подключён не тот кошелёк, который указан покупателем в сделке");
    const tx = await api(`/api/deals/${deal.id}/confirm-transaction`);
    await connector.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [{ address: tx.address, amount: tx.amountUnits, payload: tx.payload }],
    });
    showToast("Подтверждение отправлено в TON. Выплата обновится после подтверждения сети.");
  }

  async function postAction(action, extra = {}) {
    const data = await api(`/api/deals/${state.selectedDeal.id}/action`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
    state.selectedDeal = data.deal;
    await refresh();
    await openDeal(data.deal.id);
  }

  function dealAction(action) {
    const deal = state.selectedDeal;
    if (action === "pay") return payDeal().catch((error) => showToast(error.message));
    if (action === "share") {
      const url = deal.inviteUrl || `https://t.me/${state.config.botUsername}?start=join_${deal.inviteToken}`;
      return showInvite(url);
    }
    if (action === "confirm") {
      const feeNote = `Комиссия платформы по этой сделке — ${deal.fees.serviceFeeTon} TON.`;
      const actionNote = `Для on-chain подтверждения кошелёк приложит ${state.config.buyerActionTon || "0.03"} TON на выполнение операции. Это не комиссия платформы.`;
      return showModal("Подтвердить получение?", `После подписи вашим TON-кошельком контракт необратимо отправит продавцу ${deal.fees.sellerPayoutTon} TON. ${feeNote} ${actionNote}`, "Подписать в кошельке", () => confirmDealFromBuyerWallet());
    }
    if (action === "dispute") return showModal("Открыть спор?", "Выплата будет остановлена до решения арбитра. Свяжитесь с поддержкой и предоставьте доказательства.", "Открыть спор", () => postAction("dispute"), true);
    if (action === "cancel") return showModal("Отменить сделку?", "До оплаты отмена окончательная. Если транзакция уже отправлена, сначала будет проверен контракт.", "Отменить сделку", () => postAction("cancel"), true);
    if (action === "admin_cancel") {
      const refundText = "Покупателю возвращаются сумма сделки и комиссия платформы; сетевой сбор/газ учитывается контрактом отдельно. Blockchain-действие необратимо.";
      return showModal("Вернуть покупателю?", refundText, "Отправить возврат", () => postAction("admin_cancel"), true);
    }
    if (action === "admin_resolve") {
      modal.hidden = false;
      const disputeFeeNote = "Комиссия платформы удерживается отдельно по условиям сделки.";
      modal.innerHTML = `<div class="modal-card"><h2>Решить спор</h2><p>Укажите целый процент суммы сделки продавцу. Остальное получит покупатель. ${disputeFeeNote}</p><div class="field"><label>Процент продавцу</label><input id="seller-percent" type="number" min="0" max="100" value="50"></div><div class="button-row"><button id="modal-confirm" class="btn btn-primary">Продолжить</button><button id="modal-close" class="btn">Вернуться</button></div></div>`;
      document.getElementById("modal-close").onclick = () => modal.hidden = true;
      document.getElementById("modal-confirm").onclick = async (event) => { event.currentTarget.disabled = true; try { await postAction("admin_resolve", { sellerPercent: Number(document.getElementById("seller-percent").value) }); modal.hidden = true; } catch (error) { showToast(error.message); event.currentTarget.disabled = false; } };
    }
  }

  async function loadTransparency() {
    try {
      const data = await api("/api/transparency");
      const target = document.getElementById("transparency-data");
      if (!target) return;
      target.innerHTML = `<h3>Параметры сервиса</h3><dl class="kv"><dt>Сеть</dt><dd>${esc(data.network)}</dd><dt>Комиссия платформы</dt><dd>${(data.feeSchedule || []).map((item) => `${esc(item.shortLabel)} — ${esc(item.feePercentText)}%`).join(" · ")}</dd><dt>Сетевой резерв</dt><dd>${esc(data.networkFeeTon)} TON</dd><dt>Баланс газа</dt><dd>${esc(data.serviceBalanceTon)} TON (${esc(data.serviceState)})</dd><dt>Service wallet</dt><dd><button class="copy-value" data-copy="${esc(data.serviceAddress)}" data-copy-label="Адрес скопирован">${esc(data.serviceAddress)}</button></dd><dt>Hash кода</dt><dd><button class="copy-value" data-copy="${esc(data.codeHash)}" data-copy-label="Hash скопирован">${esc(data.codeHash)}</button></dd></dl><div class="link-list" style="margin-top:14px"><a href="${esc(data.explorers.tonviewer)}">Service wallet в Tonviewer ↗</a><a href="${esc(data.explorers.tonscan)}">Service wallet в Tonscan ↗</a><a href="${esc(data.gasInfoUrl || "https://docs.ton.org/contracts/techniques/gas")}" target="_blank" rel="noopener">Статья TON про gas ↗</a></div>`;
      bindCurrentView();
    } catch (error) { const target = document.getElementById("transparency-data"); if (target) target.innerHTML = `<div class="error-box">${esc(error.message)}</div>`; }
  }

  async function handleStartParam() {
    const param = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tgWebAppStartParam");
    if (!param?.startsWith("join_")) return;
    try {
      const data = await api("/api/join", { method: "POST", body: JSON.stringify({ token: param.slice(5) }) });
      await refresh();
      await openDeal(data.deal.id);
      showToast("Вы присоединились к сделке");
    } catch (error) { showToast(error.message); }
  }

  document.querySelectorAll("[data-route]").forEach((item) => item.addEventListener("click", () => setRoute(item.dataset.route)));

  (async () => {
    try {
      if (!tg?.initData) throw new Error("Для защищённой авторизации откройте Mini App кнопкой внутри Telegram-бота.");
      await refresh();
      startBackgroundSync();
      await handleStartParam();
    } catch (error) {
      view.innerHTML = `<div class="error-box"><b>Mini App не удалось открыть</b><br><br>${esc(error.message)}</div><div class="panel"><h3>Локальный просмотр</h3><p class="page-intro">Страница загружена, но операции и данные доступны только после проверки Telegram initData.</p></div>`;
      document.getElementById("tabbar").hidden = true;
      document.getElementById("site-footer").hidden = true;
    }
  })();
})();
