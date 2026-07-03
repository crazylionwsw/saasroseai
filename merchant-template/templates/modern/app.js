document.addEventListener('DOMContentLoaded', function () {
  const CART_KEY = 'rose_cart';

  let menuData = [];
  let cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  let ws = null;
  let wsConnected = false;

  const API_BASE = window.API_BASE || '';

  function getApiUrl(path) {
    return API_BASE + path;
  }

  function formatPrice(p) {
    return '¥' + parseFloat(p).toFixed(2);
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function renderCart() {
    const containers = document.querySelectorAll('.cart-items');
    const totals = document.querySelectorAll('.cart-total-value');
    if (!containers.length) return;

    containers.forEach(function (el) {
      if (!cart.length) {
        el.innerHTML = '<p style="color:#999;font-size:0.82rem;padding:12px 0;font-weight:300;">购物车为空</p>';
        return;
      }
      el.innerHTML = cart.map(function (item, idx) {
        return (
          '<div class="cart-item">' +
            '<div class="cart-item-info">' +
              '<div class="cart-item-name">' + item.name + '</div>' +
              '<div class="cart-item-price">' + formatPrice(item.price) + '</div>' +
            '</div>' +
            '<div class="cart-item-qty">' +
              '<button class="qty-btn" data-index="' + idx + '" data-action="dec">−</button>' +
              '<span>' + item.qty + '</span>' +
              '<button class="qty-btn" data-index="' + idx + '" data-action="inc">+</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    });

    const total = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    totals.forEach(function (el) { el.textContent = formatPrice(total); });
  }

  function addToCart(dish) {
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === dish.id) { existing = cart[i]; break; }
    }
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: dish.id, name: dish.name, price: dish.price, qty: 1 });
    }
    saveCart();
    renderCart();
  }

  function updateQty(index, delta) {
    if (index < 0 || index >= cart.length) return;
    cart[index].qty += delta;
    if (cart[index].qty <= 0) {
      cart.splice(index, 1);
    }
    saveCart();
    renderCart();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.qty-btn');
    if (!btn) return;
    var idx = parseInt(btn.dataset.index, 10);
    if (btn.dataset.action === 'inc') updateQty(idx, 1);
    else updateQty(idx, -1);
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.add-to-cart');
    if (!btn) return;
    var dishId = parseInt(btn.dataset.id, 10);
    var dish = null;
    for (var i = 0; i < menuData.length; i++) {
      if (menuData[i].id === dishId) { dish = menuData[i]; break; }
    }
    if (dish) addToCart(dish);
  });

  function loadMenu() {
    var containers = document.querySelectorAll('[data-menu-container]');
    if (!containers.length) return;

    containers.forEach(function (el) { el.innerHTML = '<div class="loading"><div class="spinner"></div><p>加载菜单中...</p></div>'; });

    fetch(getApiUrl('/api/menu'))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        menuData = data;
        renderMenuAll();
        renderFeatured();
      })
      .catch(function () {
        containers.forEach(function (el) { el.innerHTML = '<p style="text-align:center;color:#999;padding:40px;font-weight:300;">菜单加载失败，请稍后重试</p>'; });
      });
  }

  function renderMenuAll() {
    var containers = document.querySelectorAll('[data-menu-container]');
    var cats = {};
    menuData.forEach(function (d) {
      var c = d.category || '其他';
      if (!cats[c]) cats[c] = [];
      cats[c].push(d);
    });
    var categories = Object.keys(cats);

    containers.forEach(function (el) {
      var tabsHtml = categories.map(function (c, i) {
        return '<button class="category-tab' + (i === 0 ? ' active' : '') + '" data-cat="' + c + '">' + c + '</button>';
      }).join('');

      var currentCat = categories[0] || '';
      var itemsHtml = (cats[currentCat] || []).map(function (d) {
        var img = d.image || 'https://placehold.co/400x300/e8e0d0/666?text=' + encodeURIComponent(d.name);
        return (
          '<div class="menu-item fade-in" data-cat="' + d.category + '">' +
            '<img src="' + img + '" alt="' + d.name + '" loading="lazy" />' +
            '<div class="menu-item-body">' +
              '<h3>' + d.name + '</h3>' +
              '<div class="desc">' + (d.description || '') + '</div>' +
              '<div class="price">' + formatPrice(d.price) + '</div>' +
              '<button class="btn add-to-cart" data-id="' + d.id + '" style="margin-top:10px;padding:7px 16px;font-size:0.8rem;">加入购物车</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      el.innerHTML =
        '<div class="categories">' + tabsHtml + '</div>' +
        '<div class="menu-grid">' + itemsHtml + '</div>';

      el.querySelectorAll('.category-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          el.querySelectorAll('.category-tab').forEach(function (t) { t.classList.remove('active'); });
          tab.classList.add('active');
          var cat = tab.dataset.cat;
          var grid = el.querySelector('.menu-grid');
          grid.innerHTML = (cats[cat] || []).map(function (d) {
            var img = d.image || 'https://placehold.co/400x300/e8e0d0/666?text=' + encodeURIComponent(d.name);
            return (
              '<div class="menu-item fade-in" data-cat="' + d.category + '">' +
                '<img src="' + img + '" alt="' + d.name + '" loading="lazy" />' +
                '<div class="menu-item-body">' +
                  '<h3>' + d.name + '</h3>' +
                  '<div class="desc">' + (d.description || '') + '</div>' +
                  '<div class="price">' + formatPrice(d.price) + '</div>' +
                  '<button class="btn add-to-cart" data-id="' + d.id + '" style="margin-top:10px;padding:7px 16px;font-size:0.8rem;">加入购物车</button>' +
                '</div>' +
              '</div>'
            );
          }).join('');
        });
      });
    });
  }

  function renderFeatured() {
    var grid = document.querySelector('.featured-grid');
    if (!grid) return;
    var featured = menuData.slice(0, 4);
    grid.innerHTML = featured.map(function (d) {
      var img = d.image || 'https://placehold.co/600x400/e8e0d0/666?text=' + encodeURIComponent(d.name);
      return (
        '<div class="dish-card fade-in">' +
          '<img src="' + img + '" alt="' + d.name + '" loading="lazy" />' +
          '<div class="dish-card-body">' +
            '<h3>' + d.name + '</h3>' +
            '<div class="price">' + formatPrice(d.price) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  var orderForm = document.querySelector('.order-form');
  if (orderForm) {
    orderForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = orderForm.querySelector('[name="name"]');
      var phone = orderForm.querySelector('[name="phone"]');
      var address = orderForm.querySelector('[name="address"]');
      var note = orderForm.querySelector('[name="note"]');

      if (!name.value.trim()) { alert('请输入姓名'); name.focus(); return; }
      if (!phone.value.trim()) { alert('请输入电话'); phone.focus(); return; }
      if (!address.value.trim()) { alert('请输入地址'); address.focus(); return; }
      if (!cart.length) { alert('购物车为空，请先选择菜品'); return; }

      var submitBtn = orderForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中...';

      var payload = {
        name: name.value.trim(),
        phone: phone.value.trim(),
        address: address.value.trim(),
        note: note.value.trim(),
        items: cart.map(function (item) { return { id: item.id, name: item.name, price: item.price, qty: item.qty }; }),
        total: cart.reduce(function (s, i) { return s + i.price * i.qty; }, 0)
      };

      fetch(getApiUrl('/api/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var modal = document.getElementById('orderModal');
          if (modal) {
            modal.classList.add('open');
            var idEl = modal.querySelector('.order-id');
            var totalEl = modal.querySelector('.order-total');
            if (idEl) idEl.textContent = res.orderId || res.id || '—';
            if (totalEl) totalEl.textContent = formatPrice(payload.total);
          }
          cart = [];
          saveCart();
          renderCart();
          orderForm.reset();
        })
        .catch(function () {
          alert('订单提交失败，请稍后重试');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交订单';
        });
    });
  }

  var modalOverlay = document.getElementById('orderModal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) modalOverlay.classList.remove('open');
    });
  }

  var hamburger = document.querySelector('.hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function () {
      document.querySelector('.nav').classList.toggle('open');
    });
  }

  var chatBtn = document.querySelector('.chat-btn');
  var chatModal = document.querySelector('.chat-modal');
  if (chatBtn && chatModal) {
    chatBtn.addEventListener('click', function () {
      chatModal.classList.toggle('open');
      if (chatModal.classList.contains('open') && !wsConnected) {
        connectWebSocket();
      }
    });
  }

  var chatSend = document.querySelector('.chat-send');
  var chatInput = document.querySelector('.chat-input');
  if (chatSend && chatInput) {
    function sendMessage() {
      var text = chatInput.value.trim();
      if (!text) return;
      appendChatMessage(text, 'sent');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message', content: text }));
      } else {
        appendChatMessage('客服暂时离线，请稍后再试', 'received');
      }
      chatInput.value = '';
    }

    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage();
    });
  }

  function appendChatMessage(text, type) {
    var container = document.querySelector('.chat-messages');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'chat-msg ' + type;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function connectWebSocket() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.host + '/ws';
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = function () {
        wsConnected = true;
        appendChatMessage('已连接在线客服', 'received');
      };
      ws.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'message') {
            appendChatMessage(data.content, 'received');
          }
        } catch (_) {
          appendChatMessage(e.data, 'received');
        }
      };
      ws.onclose = function () {
        wsConnected = false;
        appendChatMessage('连接已断开', 'received');
      };
      ws.onerror = function () {
        wsConnected = false;
      };
    } catch (_) {}
  }

  renderCart();
  loadMenu();
});
