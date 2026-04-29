with open('public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

inj = """<div style=\"margin-bottom: 15px; text-align: left; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;\">
    <h3 style=\"margin-top: 0; font-size: 1rem;\">Maydon va Obyektlar</h3>
    <label style=\"display: block; cursor: pointer;\"><input type=\"checkbox\" id=\"opt-birds\" checked> Qushlar (Havoda)</label>
    <label style=\"display: block; cursor: pointer;\"><input type=\"checkbox\" id=\"opt-civilians\" checked> Fuqarolar (Yuradigan)</label>
    <label style=\"display: block; cursor: pointer;\"><input type=\"checkbox\" id=\"opt-animals\" checked> Hayvonlar</label>
    <select id=\"map-select\" style=\"width: 100%; margin-top: 10px; padding: 8px; border-radius: 5px; background: #334155; color: white; border: none;\">
        <option value=\"field\">Dala maydoni</option>
        <option value=\"castle\">Qal'a maydoni</option>
        <option value=\"desert\">Sahro maydoni</option>
        <option value=\"snow\">Qish maydoni</option>
        <option value=\"forest\">O'rmon maydoni</option>
    </select>
</div>
<button id=\"btn-single\""""

if '<div style="margin-bottom: 15px; text-align: left; background:' not in text:
    text = text.replace('<button id="btn-single"', inj)
    text = text.replace('client.js?v=4', 'client.js?v=6')
    text = text.replace('client.js?v=5', 'client.js?v=6')
    with open('public/index.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Done!")
else:
    print("Already there!")
