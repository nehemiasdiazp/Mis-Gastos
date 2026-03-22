// ============================================================
//  MisGastos v2 — Google Apps Script
//  Soporta push (guardar) y pull (leer) para sincronización
//  entre dispositivos. Sheets es la fuente de verdad.
// ============================================================

function doGet(e) {
  try {
    var action = e.parameter.action || 'ping';

    if (action === 'push') {
      var payload = JSON.parse(decodeURIComponent(e.parameter.data || '{}'));
      return pushExpenses(payload.expenses || []);
    }

    if (action === 'pull') {
      var month = e.parameter.month || getCurrentMonth();
      return pullExpenses(month);
    }

    if (action === 'delete') {
      return deleteExpense(e.parameter.id);
    }

    return respond({ ok: true, message: 'MisGastos API v2 activa' });

  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

// ── PUSH: recibe gastos desde la app y los escribe en Sheets ──
function pushExpenses(expenses) {
  if (!expenses.length) return respond({ ok: true, count: 0 });

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  expenses.forEach(function(exp) {
    var sheetName = formatMonthName(exp.month);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      setupSheet(sheet);
    }

    // Verificar si el ID ya existe para no duplicar
    var data = sheet.getDataRange().getValues();
    var exists = data.some(function(row) { return row[0] == exp.id; });
    if (!exists) {
      sheet.appendRow([
        exp.id,
        new Date(exp.date),
        exp.cat,
        getCatName(exp.cat),
        exp.desc || '',
        exp.amount,
        'ARS',
        exp.month
      ]);
    }
  });

  updateSummary(ss);
  return respond({ ok: true, count: expenses.length });
}

// ── PULL: lee todos los gastos del mes desde Sheets ──
function pullExpenses(month) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = formatMonthName(month);
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return respond({ ok: true, expenses: [], month: month });
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return respond({ ok: true, expenses: [], month: month });
  }

  // Skip header row
  var expenses = data.slice(1).map(function(row) {
    return {
      id:     String(row[0]),
      date:   row[1] instanceof Date ? row[1].toISOString() : row[1],
      cat:    String(row[2]),
      desc:   String(row[4] || ''),
      amount: parseFloat(row[5]) || 0,
      month:  String(row[7]),
      synced: true
    };
  }).filter(function(e) { return e.id && e.amount > 0; });

  return respond({ ok: true, expenses: expenses, month: month });
}

// ── DELETE: elimina un gasto por ID ──
function deleteExpense(id) {
  if (!id) return respond({ ok: false, error: 'ID requerido' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var deleted = false;

  sheets.forEach(function(sheet) {
    if (sheet.getName() === '📊 Resumen') return;
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(id)) {
        sheet.deleteRow(i + 1);
        deleted = true;
      }
    }
  });

  if (deleted) updateSummary(ss);
  return respond({ ok: true, deleted: deleted });
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCurrentMonth() {
  var n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
}

function formatMonthName(month) {
  var parts = month.split('-');
  var year = parts[0];
  var mo = parseInt(parts[1]) - 1;
  var names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return names[mo] + ' ' + year;
}

function getCatName(catId) {
  var map = {
    salidas:     'Salidas / Restaurant',
    combustible: 'Combustible',
    peaje:       'Peaje',
    ropa:        'Ropa',
    regalos:     'Regalos',
    cafes:       'Cafés',
  };
  return map[catId] || catId;
}

function setupSheet(sheet) {
  var headers = ['ID','Fecha','Cat ID','Categoría','Descripción','Monto','Moneda','Mes'];
  sheet.appendRow(headers);

  var hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setBackground('#1a1a18');
  hr.setFontColor('#ffffff');
  hr.setFontWeight('bold');
  hr.setFontSize(11);

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 240);
  sheet.setColumnWidth(6, 120);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 100);

  sheet.getRange('B:B').setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange('F:F').setNumberFormat('$ #,##0.00');
  sheet.setFrozenRows(1);
}

function updateSummary(ss) {
  var NAME = '📊 Resumen';
  var s = ss.getSheetByName(NAME) || ss.insertSheet(NAME, 0);
  s.clearContents();

  s.getRange('A1').setValue('MisGastos — Resumen por mes').setFontSize(14).setFontWeight('bold');
  s.getRange('A3:D3').setValues([['Mes','Total ARS','Registros','Promedio']]);
  s.getRange('A3:D3').setFontWeight('bold').setBackground('#1a1a18').setFontColor('#ffffff');

  var sheets = ss.getSheets();
  var row = 4;
  sheets.forEach(function(sh) {
    if (sh.getName() === NAME) return;
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return;
    var rows = data.slice(1);
    var total = rows.reduce(function(acc, r) { return acc + (parseFloat(r[5]) || 0); }, 0);
    var count = rows.length;
    var avg = count ? total / count : 0;
    s.getRange(row, 1, 1, 4).setValues([[sh.getName(), total, count, avg]]);
    s.getRange(row, 2).setNumberFormat('$ #,##0.00');
    s.getRange(row, 4).setNumberFormat('$ #,##0.00');
    row++;
  });

  [160, 140, 100, 140].forEach(function(w, i) { s.setColumnWidth(i + 1, w); });
}
