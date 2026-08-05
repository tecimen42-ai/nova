from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT = Path(r"C:\Users\cagla\Documents\Codex\2026-08-05\dos\outputs\github-vercel-yayin-rehberi.gif")
W, H = 960, 540
BG, INK, PAPER, CORAL, MUTED = '#171719', '#171719', '#f3f0ea', '#ff5a42', '#aaa6a0'
font = r'C:\Windows\Fonts\arial.ttf'
bold = r'C:\Windows\Fonts\arialbd.ttf'

def f(size, b=False): return ImageFont.truetype(bold if b else font, size)
def wrap(draw, text, font_obj, max_width):
    words, lines, line = text.split(), [], ''
    for word in words:
        trial = (line + ' ' + word).strip()
        if draw.textbbox((0,0), trial, font=font_obj)[2] <= max_width: line = trial
        else: lines.append(line); line = word
    if line: lines.append(line)
    return lines
def frame(slide, t):
    img = Image.new('RGB', (W,H), BG); d = ImageDraw.Draw(img)
    # top bar
    d.text((55,42), 'NOVA / CANLIYA ALMA REHBERİ', font=f(14, True), fill=CORAL)
    d.text((W-110,42), f'{slide[0]}/06', font=f(14), fill=MUTED)
    # accent blobs
    pulse = int(8*math.sin(t*2))
    d.ellipse((W-145-pulse, 66-pulse, W-25+pulse, 186+pulse), fill=CORAL)
    d.ellipse((W-108, 103, W-62, 149), fill=PAPER)
    title_lines = wrap(d, slide[1], f(48, True), 700)
    y=115
    for line in title_lines:
        d.text((55,y),line,font=f(48,True),fill=PAPER); y+=58
    y += 20
    for line in wrap(d, slide[2], f(22), 650):
        d.text((55,y),line,font=f(22),fill='#d7d2ca'); y+=32
    # action card
    cy=390
    d.rounded_rectangle((55,cy,905,cy+86), radius=12, fill=PAPER)
    d.text((80,cy+20), slide[3], font=f(21,True), fill=INK)
    d.text((80,cy+51), slide[4], font=f(14), fill='#5b5854')
    # timeline
    for i in range(6):
        x=55+i*35; color=CORAL if i < slide[0] else '#4a484a'
        d.rounded_rectangle((x,505,x+24,510),radius=3,fill=color)
    return img

slides = [
 (1, 'Siteni birkaç dakikada canlıya al.', 'Bu kısa rehber, HTML siteni ücretsiz bir bağlantıyla internete taşır.', 'Gerekenler', 'Bir GitHub hesabı ve bir Vercel hesabı.'),
 (2, 'GitHub’da yeni bir depo oluştur.', 'github.com üzerinden “New repository” seçeneğine tıkla. Depoya örneğin nova-site adını ver.', 'İpucu', 'Depoyu Public olarak oluşturabilirsin.'),
 (3, 'Site dosyalarını yükle.', 'Yeni depoda “Add file” → “Upload files” seç. index.html, style.css ve script.js dosyalarını sürükle.', 'Önemli', 'index.html dosyası en üst klasörde olmalı.'),
 (4, 'Değişiklikleri kaydet.', 'Sayfanın altındaki “Commit changes” düğmesine tıkla. Dosyaların artık GitHub’da güvenli.', 'Sonuç', 'Site kodun yayın için hazır.'),
 (5, 'Vercel’de projeyi içe aktar.', 'vercel.com’da “New Project” seç. GitHub hesabını bağla ve az önce oluşturduğun depoyu seç.', 'Ayar', 'Bu site için ek kurulum gerekmiyor.'),
 (6, 'Deploy’a tıkla — siten yayında!', 'Vercel birkaç saniyede sana nova-site.vercel.app gibi canlı bir adres verecek. Sonradan kendi alan adını da bağlayabilirsin.', 'Güncellemek çok kolay', 'GitHub’a yeni dosya yüklediğinde site otomatik yenilenir.'),
]

frames=[]
for s in slides:
    for i in range(28): frames.append(frame(s, i/12))
OUT.parent.mkdir(parents=True, exist_ok=True)
frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=105, loop=0, optimize=True)
print(OUT)
