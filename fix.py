import sys

file_path = 'public/index.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add artillery to shop
shop_wall_chunk = '''                        <div class="shop-meta"><span id="shop-wall-max">Soni: 0</span></div>
                    </div>
                    <button id="btn-buy-wall" class="primary-btn shop-buy-btn" style="width:100%; padding:8px 10px; font-size:0.85rem; background:#0f766e;">+1 Tahta devor sotib olish</button>
                </div>'''

shop_artillery_chunk = shop_wall_chunk + '''
                <div class="shop-item">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <span class="shop-item-title">💣 Artileriya</span>
                    </div>
                    <div class="shop-item-desc">Bir marta o'q uzadi, devorni yakson qiladi yoki dushmanga 50% zarar yetkazadi.</div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; margin-bottom:10px;">
                        <div class="shop-price">
                            <span style="font-size:1.2rem; margin-right:5px;">🪙</span>
                            <b id="artillery-buy-cost">500</b>
                        </div>
                        <div class="shop-meta"><span id="shop-artillery-max">Soni: 0</span></div>
                    </div>
                    <button id="btn-buy-artillery" class="primary-btn shop-buy-btn" style="width:100%; padding:8px 10px; font-size:0.85rem; background:#ef4444;">+1 Artileriya sotib olish</button>
                </div>'''

content = content.replace(shop_wall_chunk, shop_artillery_chunk)

# Add artillery button next to crow
crow_btn_chunk = '''                <button id="crow-button" class="icon-btn crow-btn" style="pointer-events: auto;" aria-label="Qarg'alarni otish">
                    🐦
                    <span id="crow-count" class="shield-count">3</span>
                </button>'''

artillery_btn_chunk = crow_btn_chunk + '''
                <button id="artillery-button" class="icon-btn artillery-btn" style="pointer-events: auto; display:none;" aria-label="Artileriya otish">
                    💣
                    <span id="artillery-count" class="shield-count">0</span>
                </button>'''

content = content.replace(crow_btn_chunk, artillery_btn_chunk)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
