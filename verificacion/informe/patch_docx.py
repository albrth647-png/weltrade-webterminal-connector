#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post-procesado WPS/Office del informe:
   1) elimina <w:pgNumType/> vacíos de la sección de portada
   2) parchea el campo PAGE del pie con el switch \\* arabic
"""
import re, shutil, sys, zipfile, os

SRC = '/home/z/my-project/download/Auditoria_profunda_weltrade-webterminal-connector.docx'
TMP = '/tmp/informe_patch'

if os.path.exists(TMP):
    shutil.rmtree(TMP)
with zipfile.ZipFile(SRC) as z:
    z.extractall(TMP)

# 1) quitar pgNumType vacíos del documento
doc_path = os.path.join(TMP, 'word', 'document.xml')
xml = open(doc_path, encoding='utf-8').read()
n1 = len(re.findall(r'<w:pgNumType/>', xml))
xml = xml.replace('<w:pgNumType/>', '')

# 1b) eliminar la entrada-hyperlink residual del primer párrafo del TOC
#     (quedaba junto al fldChar "separate" y duplicaba la 1.ª entrada)
xml, n_hyp = re.subn(
    r'(<w:fldChar w:fldCharType="separate"/></w:r>)<w:hyperlink[^>]*>.*?</w:hyperlink>',
    r'\1', xml, count=1, flags=re.S)
print('pgNumType vacíos eliminados:', n1, '| hyperlink residual del TOC eliminado:', n_hyp)
open(doc_path, 'w', encoding='utf-8').write(xml)

# 2) parchear footers: PAGE -> PAGE \* arabic \* MERGEFORMAT
for name in os.listdir(os.path.join(TMP, 'word')):
    if name.startswith('footer') and name.endswith('.xml'):
        p = os.path.join(TMP, 'word', name)
        s = open(p, encoding='utf-8').read()
        s2, n = re.subn(
            r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
            r'\1 PAGE \\* arabic \\* MERGEFORMAT \2', s)
        if n:
            open(p, 'w', encoding='utf-8').write(s2)
            print(f'{name}: {n} campo(s) PAGE parcheado(s)')

# reempaquetar
if os.path.exists(SRC):
    os.remove(SRC)
zf = zipfile.ZipFile(SRC, 'w', zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(TMP):
    for f in files:
        full = os.path.join(root, f)
        rel = os.path.relpath(full, TMP)
        zf.write(full, rel)
zf.close()
print('Reempaquetado OK:', SRC)
