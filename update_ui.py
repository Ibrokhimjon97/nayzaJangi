with open('public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

inj = """<label id=\"txt-archer-lbl\" style=\"display:block; margin-bottom:5px;\">Jangchi modeli:</label>
<select id=\"select-archer-model\" style=\"width:100%; padding:8px; border-radius:5px; background:#334155; color:white; border:none; margin-bottom:15px;\">
    <option value=\"0\">Qora kiyimlik kamonchi</option>
    <option value=\"1\">Yashil kiyimlik kamonchi</option>
    <option value=\"2\">Oltin qoplamali kamonchi</option>
</select>

<label id=\"txt-spear-lbl\" style=\"display:block; margin-bottom:5px;\">Nayza modeli:</label>
<select id=\"select-spear-model\" style=\"width:100%; padding:8px; border-radius:5px; background:#334155; color:white; border:none; margin-bottom:15px;\">
    <option value=\"0\">Temir nayza</option>
    <option value=\"1\">Yog'och nayza</option>
    <option value=\"2\">Nayza 3</option>
</select>
<label id=\"txt-country-lbl\""""

if 'select-archer-model' not in text:
    text = text.replace('<label id=\"txt-country-lbl\"', inj)

text = text.replace('client.js?v=6', 'client.js?v=7')

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)
