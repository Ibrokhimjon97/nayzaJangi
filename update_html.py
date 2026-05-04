import sys

file_path = 'public/model_creator.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add weapon type
old_name = '''            <div class="form-group">
                <label>Model nomi:</label>
                <input type="text" id="modelName" name="name" placeholder="Masalan: Qahramon" required>
            </div>'''
new_name = '''            <div class="form-group">
                <label>Model nomi:</label>
                <input type="text" id="modelName" name="name" placeholder="Masalan: Qahramon" required>
            </div>
            <div class="form-group">
                <label>Qurol turi:</label>
                <select id="weaponType" name="weaponType" style="width:100%; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white;">
                    <option value="spear">Nayza</option>
                    <option value="bow">Kamon</option>
                </select>
            </div>'''
content = content.replace(old_name, new_name)

# Add shieldAfterShot
old_shield = '''                <div class="form-group">
                    <label>Qalqon sinishi (Break):</label>
                    <input type="file" name="shieldBreak" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-s-break')">
                    <img id="prev-s-break" class="preview-img">
                </div>
            </div>'''
new_shield = '''                <div class="form-group">
                    <label>Qalqon sinishi (Break):</label>
                    <input type="file" name="shieldBreak" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-s-break')">
                    <img id="prev-s-break" class="preview-img">
                </div>
            </div>
            <div class="flex-row">
                <div class="form-group">
                    <label>Otgandan so'ng (After Shot):</label>
                    <input type="file" name="shieldAfterShot" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-s-after')">
                    <img id="prev-s-after" class="preview-img">
                </div>
                <div class="form-group"></div>
            </div>'''
content = content.replace(old_shield, new_shield)

# Add noShieldAfterShot
old_noShield = '''                <div class="form-group">
                    <label>Yarador/Yiqilish (Hurt):</label>
                    <input type="file" name="noShieldHurt" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-ns-hurt')">
                    <img id="prev-ns-hurt" class="preview-img">
                </div>
            </div>'''
new_noShield = '''                <div class="form-group">
                    <label>Yarador/Yiqilish (Hurt):</label>
                    <input type="file" name="noShieldHurt" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-ns-hurt')">
                    <img id="prev-ns-hurt" class="preview-img">
                </div>
            </div>
            <div class="flex-row">
                <div class="form-group">
                    <label>Otgandan so'ng (After Shot):</label>
                    <input type="file" name="noShieldAfterShot" class="file-input" accept="image/png, image/jpeg" required onchange="preview(this, 'prev-ns-after')">
                    <img id="prev-ns-after" class="preview-img">
                </div>
                <div class="form-group"></div>
            </div>'''
content = content.replace(old_noShield, new_noShield)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('model_creator.html updated!')
