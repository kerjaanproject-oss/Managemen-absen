var SHEET_USERS = 'Users';
var SHEET_KARYAWAN = 'Karyawan';
var SHEET_SHIFT = 'Shift';
var SHEET_ABSEN = 'Absensi';
var SHEET_SETTINGS = 'Settings';

/**
 * Retrieves the active spreadsheet or throws an actionable error message
 */
function getSS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet tidak terdeteksi! Pastikan skrip ini dibuka via menu Ekstensi > Apps Script di dalam Google Sheets.');
  }
  return ss;
}

/**
 * Serves the web application HTML template
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Aplikasi Absensi Karyawan Fingerprint')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Initializes Google Sheets database structure with headers and default values
 */
function setupDatabase() {
  try {
    var ss = getSS();

    var sheets = [
      { name: SHEET_USERS, headers: ['Username', 'PasswordHash', 'Fullname', 'Role', 'Status'] },
      { name: SHEET_KARYAWAN, headers: ['ID Karyawan', 'Nama Karyawan', 'Jabatan', 'Departemen'] },
      { name: SHEET_SHIFT, headers: ['ID Shift', 'Nama Shift', 'Jam Masuk Standar', 'Jam Pulang Standar'] },
      { name: SHEET_ABSEN, headers: ['ID Absen', 'Tanggal', 'ID Karyawan', 'Nama Karyawan', 'Jabatan', 'Departemen', 'Keterangan', 'Shift', 'Std Masuk', 'Std Pulang', 'Jam Masuk', 'Jam Pulang', 'Total Jam', 'Status'] },
      { name: SHEET_SETTINGS, headers: ['Key', 'Value'] }
    ];

    sheets.forEach(function (s) {
      var sheet = ss.getSheetByName(s.name);
      if (!sheet) {
        sheet = ss.insertSheet(s.name);
        sheet.appendRow(s.headers);
        sheet.getRange(1, 1, 1, s.headers.length).setFontWeight('bold').setBackground('#e2e8f0');
      }
    });

    // Migrasi: pastikan kolom 'Keterangan' ada pada sheet Absensi
    var absenSheetMig = ss.getSheetByName(SHEET_ABSEN);
    if (absenSheetMig && absenSheetMig.getLastRow() >= 1) {
      var absenHeaders = absenSheetMig.getRange(1, 1, 1, absenSheetMig.getLastColumn()).getValues()[0];
      if (absenHeaders.indexOf('Keterangan') === -1) {
        absenSheetMig.insertColumnAfter(6);
        absenSheetMig.getRange(1, 7).setValue('Keterangan');
        absenSheetMig.getRange(1, 7).setFontWeight('bold').setBackground('#e2e8f0');
      }
    }

    // Ensure Default Users
    var userSheet = ss.getSheetByName(SHEET_USERS);
    if (userSheet && userSheet.getLastRow() <= 1) {
      var defaultPasswordHash = hashPassword('Admin@2026');
      userSheet.appendRow(['admin', defaultPasswordHash, 'Administrator HRD', 'Admin', 'Active']);
      userSheet.appendRow(['staff', defaultPasswordHash, 'Staff Inputer', 'Staff', 'Active']);
    }

    // Ensure Default Settings
    var setSheet = ss.getSheetByName(SHEET_SETTINGS);
    if (setSheet && setSheet.getLastRow() <= 1) {
      setSheet.appendRow(['ToleransiMenit', '10']);
      setSheet.appendRow(['ZonaWaktu', 'Asia/Jakarta']);
      var defaultPepper = Utilities.getUuid().replace(/-/g, '').substring(0, 32);
      setSheet.appendRow(['PepperKey', defaultPepper]);
    } else if (setSheet && !getPepper()) {
      setSheet.appendRow(['PepperKey', Utilities.getUuid().replace(/-/g, '').substring(0, 32)]);
    }

    // Ensure Default Shift
    var shiftSheet = ss.getSheetByName(SHEET_SHIFT);
    if (shiftSheet && shiftSheet.getLastRow() <= 1) {
      shiftSheet.appendRow(['SFT-1', 'Shift Pagi (Normal)', '08:00', '17:00']);
      shiftSheet.appendRow(['SFT-2', 'Shift Siang', '13:00', '21:00']);
      shiftSheet.appendRow(['SFT-3', 'Shift Malam', '22:00', '06:00']);
    }

    return { success: true, message: 'Database & Sheet berhasil disiapkan!' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Reads the secret pepper from Settings sheet for password hashing
 */
function getPepper() {
  var ss = getSS();
  var setSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (setSheet && setSheet.getLastRow() > 1) {
    var data = setSheet.getRange(2, 1, setSheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === 'PepperKey') {
        var val = String(data[i][1] || '').trim();
        if (val) return val;
      }
    }
  }
  return '';
}

/**
 * Hashes passwords using SHA-256 with a secret pepper
 */
function hashPassword(password) {
  if (!password) return '';
  var pepper = getPepper();
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pepper + password));
  var txtHash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var byteVal = rawHash[i];
    if (byteVal < 0) byteVal += 256;
    var byteHex = byteVal.toString(16);
    if (byteHex.length === 1) byteHex = '0' + byteHex;
    txtHash += byteHex;
  }
  return txtHash;
}

/**
 * Checks if a username has exceeded maximum failed login attempts
 */
function checkLoginRateLimit(username) {
  var cache = CacheService.getScriptCache();
  var count = parseInt(cache.get('fail_count_' + username) || '0');
  return count >= 5;
}

function recordLoginFailure(username) {
  var cache = CacheService.getScriptCache();
  var count = parseInt(cache.get('fail_count_' + username) || '0') + 1;
  cache.put('fail_count_' + username, count.toString(), 900); // 15 mins lock
}

function clearLoginFailures(username) {
  var cache = CacheService.getScriptCache();
  cache.remove('fail_count_' + username);
}

/**
 * Generates and stores a session token in CacheService for 8 hours
 */
function generateSessionToken(username, role) {
  var token = Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  var sessionData = JSON.stringify({ username: username, role: role });
  cache.put('session_' + token, sessionData, 28800); // 8 Hours
  return token;
}

function validateSession(token) {
  if (!token) return { valid: false, message: 'Token tidak terlampir' };
  var cache = CacheService.getScriptCache();
  var sessionDataStr = cache.get('session_' + token);
  if (!sessionDataStr) return { valid: false, message: 'Sesi habis atau tidak valid' };
  try {
    var data = JSON.parse(sessionDataStr);
    return { valid: true, username: data.username, role: data.role };
  } catch (e) {
    return { valid: false, message: 'Format sesi rusak' };
  }
}

function destroySession(token) {
  if (!token) return { success: true };
  var cache = CacheService.getScriptCache();
  cache.remove('session_' + token);
  return { success: true };
}

function logAction(username, action, detail) {
  // AuditLog disabled
}

function sanitizeInput(val, maxLength) {
  if (val === null || val === undefined) return '';
  var str = String(val);
  // Strip HTML tags
  str = str.replace(/<[^>]*>?/gm, '');
  // Strip script injection patterns
  str = str.replace(/javascript\s*:/gi, '');
  str = str.replace(/on\w+\s*=/gi, '');
  str = str.replace(/data\s*:\s*text\s*\/\s*html/gi, '');
  // Strip null bytes and control characters (except tab, newline, carriage return)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Prevent formula injection for spreadsheet (leading =, +, -, @)
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  str = str.trim();
  if (maxLength && str.length > maxLength) {
    str = str.substring(0, maxLength);
  }
  return str;
}

/**
 * Authenticates user credentials against the Users sheet
 */
function loginUser(username, password) {
  try {
    var cleanU = sanitizeInput(username, 50);
    if (!cleanU || !password) {
      return { success: false, message: 'Username dan password wajib diisi!' };
    }

    if (checkLoginRateLimit(cleanU)) {
      return { success: false, message: 'Terlalu banyak percobaan gagal. Silakan coba 15 menit lagi.' };
    }

    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_USERS);
    if (!sheet) {
      setupDatabase();
      sheet = ss.getSheetByName(SHEET_USERS);
    }

    var data = sheet.getDataRange().getValues();
    var inputHash = hashPassword(password);
    // Fallback hash (old method without pepper)
    var inputHashOld = (function () {
      if (!password) return '';
      var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password));
      var txt = '';
      for (var j = 0; j < raw.length; j++) {
        var b = raw[j]; if (b < 0) b += 256;
        var h = b.toString(16); if (h.length === 1) h = '0' + h;
        txt += h;
      }
      return txt;
    })();

    for (var i = 1; i < data.length; i++) {
      var rowU = String(data[i][0]).trim();
      var rowP = String(data[i][1]).trim();
      var rowFull = String(data[i][2]).trim();
      var rowRole = String(data[i][3]).trim();
      var rowStatus = String(data[i][4]).trim();

      if (rowU.toLowerCase() === cleanU.toLowerCase()) {
        if (rowStatus !== 'Active') {
          return { success: false, message: 'Akun Anda telah dinonaktifkan.' };
        }
        // Try new hash (with pepper) first, then fallback to old hash
        if (rowP === inputHash || rowP === inputHashOld) {
          clearLoginFailures(cleanU);
          var token = generateSessionToken(cleanU, rowRole);
          logAction(cleanU, 'LOGIN', 'Berhasil masuk sistem');
          return {
            success: true,
            token: token,
            user: { username: cleanU, fullname: rowFull, role: rowRole }
          };
        } else {
          recordLoginFailure(cleanU);
          logAction(cleanU, 'LOGIN_FAILED', 'Password salah');
          return { success: false, message: 'Password salah!' };
        }
      }
    }

    return { success: false, message: 'Username tidak ditemukan!' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Fetches all master data (Karyawan, Shift, Absensi, Settings) for the app
 */
function getInitialData(token) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    setupDatabase();

    // Fetch Settings Toleransi & Zona Waktu & Master Data
    var setSheet = ss.getSheetByName(SHEET_SETTINGS);
    var toleransiVal = 10;
    var timezoneVal = 'Asia/Jakarta';
    var masterJabatanStr = '';
    var masterDeptStr = '';
    if (setSheet && setSheet.getLastRow() > 1) {
      var rawSet = setSheet.getRange(2, 1, setSheet.getLastRow() - 1, 2).getValues();
      rawSet.forEach(function (s) {
        if (String(s[0]) === 'ToleransiMenit') toleransiVal = parseInt(s[1]);
        if (String(s[0]) === 'ZonaWaktu' && s[1]) timezoneVal = String(s[1]).trim();
        if (String(s[0]) === 'MasterJabatan' && s[1]) masterJabatanStr = String(s[1]).trim();
        if (String(s[0]) === 'MasterDept' && s[1]) masterDeptStr = String(s[1]).trim();
      });
    }

    var timeZone = timezoneVal || ss.getSpreadsheetTimeZone() || 'Asia/Jakarta';

    function formatTimeValue(val, tz) {
      if (!val) return '';
      if (val instanceof Date) {
        return Utilities.formatDate(val, tz || 'Asia/Jakarta', 'HH:mm');
      }
      var str = String(val).trim();
      if (str.indexOf('1899') !== -1 || str.indexOf('GMT') !== -1 || str.length > 15) {
        try {
          var d = new Date(str);
          if (!isNaN(d.getTime())) {
            return Utilities.formatDate(d, tz || 'Asia/Jakarta', 'HH:mm');
          }
        } catch (e) { }
      }
      var isPM = /pm/i.test(str);
      var isAM = /am/i.test(str);
      var match = str.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        var h = parseInt(match[1], 10);
        var m = parseInt(match[2], 10);
        if (isPM && h < 12) h += 12;
        if (isAM && h === 12) h = 0;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
      return str;
    }

    // Fetch Karyawan
    var karSheet = ss.getSheetByName(SHEET_KARYAWAN);
    var karData = [];
    if (karSheet && karSheet.getLastRow() > 1) {
      var rawKar = karSheet.getRange(2, 1, karSheet.getLastRow() - 1, 4).getValues();
      rawKar.forEach(function (r) {
        if (r[0]) karData.push({ id: String(r[0]), nama: String(r[1]), jabatan: String(r[2]), dept: String(r[3]) });
      });
    }

    // Fetch Shift
    var shiftSheet = ss.getSheetByName(SHEET_SHIFT);
    var shiftData = [];
    if (shiftSheet && shiftSheet.getLastRow() > 1) {
      var rawShift = shiftSheet.getRange(2, 1, shiftSheet.getLastRow() - 1, 4).getDisplayValues();
      rawShift.forEach(function (r) {
        if (r[0]) {
          var masuk = formatTimeValue(r[2], timeZone) || String(r[2] || '').trim();
          var pulang = formatTimeValue(r[3], timeZone) || String(r[3] || '').trim();
          shiftData.push({
            id: String(r[0]),
            nama: String(r[1]),
            stdMasuk: masuk,
            stdPulang: pulang
          });
        }
      });
    }

    // Fetch Absen
    var absenSheet = ss.getSheetByName(SHEET_ABSEN);
    var absenData = [];
    if (absenSheet && absenSheet.getLastRow() > 1) {
      var rawAbsen = absenSheet.getRange(2, 1, absenSheet.getLastRow() - 1, 14).getValues();
      rawAbsen.forEach(function (r) {
        if (r[0]) {
          var tglStr = r[1] instanceof Date ? Utilities.formatDate(r[1], timeZone, 'yyyy-MM-dd') : String(r[1]);
          absenData.push({
            id: String(r[0]),
            tanggal: tglStr,
            idKaryawan: String(r[2]),
            nama: String(r[3]),
            jabatan: String(r[4]),
            dept: String(r[5]),
            keterangan: String(r[6]),
            shiftNama: String(r[7]),
            stdMasuk: formatTimeValue(r[8], timeZone),
            stdPulang: formatTimeValue(r[9], timeZone),
            jamMasuk: formatTimeValue(r[10], timeZone),
            jamPulang: formatTimeValue(r[11], timeZone),
            totalJam: String(r[12]),
            status: String(r[13])
          });
        }
      });
    }

    return {
      success: true,
      karyawan: karData,
      shift: shiftData,
      absen: absenData,
      toleransi: toleransiVal,
      timezone: timezoneVal,
      masterJabatan: masterJabatanStr ? masterJabatanStr.split(',') : [],
      masterDept: masterDeptStr ? masterDeptStr.split(',') : []
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Creates or updates an employee record with concurrency lock
 */
function saveKaryawan(token, payload, editId) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: 'Sistem sedang sibuk. Silakan coba lagi.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_KARYAWAN);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_KARYAWAN); }

    var id = sanitizeInput(payload.id, 20);
    var nama = sanitizeInput(payload.nama, 100);
    var jabatan = sanitizeInput(payload.jabatan, 50);
    var dept = sanitizeInput(payload.dept, 50);

    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === (editId || id)) {
        foundIndex = i + 1;
        break;
      }
    }

    if (foundIndex !== -1) {
      sheet.getRange(foundIndex, 1, 1, 4).setValues([[id, nama, jabatan, dept]]);
      logAction(session.username, 'UPDATE_KARYAWAN', 'Update Karyawan ID: ' + id);
    } else {
      sheet.appendRow([id, nama, jabatan, dept]);
      logAction(session.username, 'CREATE_KARYAWAN', 'Tambah Karyawan ID: ' + id);
    }

    return { success: true, message: 'Data karyawan berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deletes an employee record (Admin only)
 */
function deleteKaryawan(token, id) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };
  if (session.role !== 'Admin') return { success: false, message: 'Akses ditolak. Hanya Admin yang dapat menghapus.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_KARYAWAN);
    if (!sheet) return { success: false, message: 'Data karyawan tidak ditemukan' };

    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.deleteRow(i + 1);
        logAction(session.username, 'DELETE_KARYAWAN', 'Hapus Karyawan ID: ' + id);
        return { success: true, message: 'Karyawan terhapus' };
      }
    }
    return { success: false, message: 'Data karyawan tidak ditemukan' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batch deletes employee records (Admin only)
 */
function batchDeleteKaryawan(token, ids) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };
  if (session.role !== 'Admin') return { success: false, message: 'Hanya Admin yang dapat menghapus.' };
  if (!Array.isArray(ids) || ids.length === 0) return { success: false, message: 'Pilih minimal satu data untuk dihapus.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_KARYAWAN);
    if (!sheet) return { success: false, message: 'Data karyawan tidak ditemukan' };

    var idMap = {};
    ids.forEach(function (id) { idMap[String(id).trim()] = true; });

    var data = sheet.getDataRange().getValues();
    var deletedCount = 0;

    for (var i = data.length - 1; i >= 1; i--) {
      if (idMap[String(data[i][0]).trim()]) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }

    return { success: true, message: deletedCount + ' data karyawan berhasil dihapus' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Saves attendance records with lock protection
 */
function saveAbsen(token, payload, editId) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_ABSEN);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_ABSEN); }

    var id = editId || ('ABS-' + Math.floor(1000 + Math.random() * 9000));
    var rowData = [
      id,
      sanitizeInput(payload.tanggal, 20),
      sanitizeInput(payload.idKaryawan, 20),
      sanitizeInput(payload.nama, 100),
      sanitizeInput(payload.jabatan, 50),
      sanitizeInput(payload.dept, 50),
      sanitizeInput(payload.keterangan, 100),
      sanitizeInput(payload.shiftNama, 50),
      sanitizeInput(payload.stdMasuk, 10),
      sanitizeInput(payload.stdPulang, 10),
      sanitizeInput(payload.jamMasuk, 10),
      sanitizeInput(payload.jamPulang, 10),
      sanitizeInput(payload.totalJam, 30),
      sanitizeInput(payload.status, 20)
    ];

    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === editId) {
        foundIndex = i + 1;
        break;
      }
    }

    if (foundIndex !== -1) {
      sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]);
      logAction(session.username, 'UPDATE_ABSEN', 'Update Absen ID: ' + id);
    } else {
      sheet.appendRow(rowData);
      logAction(session.username, 'CREATE_ABSEN', 'Tambah Absen ID: ' + id);
    }

    return { success: true, message: 'Absensi berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deletes an attendance record (Admin only)
 */
function deleteAbsen(token, id) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };
  if (session.role !== 'Admin') return { success: false, message: 'Hanya Admin yang dapat menghapus.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_ABSEN);
    if (!sheet) return { success: false, message: 'Data absensi tidak ditemukan' };

    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.deleteRow(i + 1);
        logAction(session.username, 'DELETE_ABSEN', 'Hapus Absen ID: ' + id);
        return { success: true, message: 'Data absensi terhapus' };
      }
    }
    return { success: false, message: 'Data absensi tidak ditemukan' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Batch deletes attendance records (Admin only)
 */
function batchDeleteAbsen(token, ids) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };
  if (session.role !== 'Admin') return { success: false, message: 'Hanya Admin yang dapat menghapus.' };
  if (!Array.isArray(ids) || ids.length === 0) return { success: false, message: 'Pilih minimal satu data untuk dihapus.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_ABSEN);
    if (!sheet) return { success: false, message: 'Data absensi tidak ditemukan' };

    var idMap = {};
    ids.forEach(function (id) { idMap[String(id).trim()] = true; });

    var data = sheet.getDataRange().getValues();
    var deletedCount = 0;

    for (var i = data.length - 1; i >= 1; i--) {
      if (idMap[String(data[i][0]).trim()]) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }

    return { success: true, message: deletedCount + ' data absensi berhasil dihapus' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Saves or updates shift schedules
 */
function saveShift(token, payload, editId) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_SHIFT);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_SHIFT); }

    var nama = sanitizeInput(payload.nama, 50);
    var stdMasuk = sanitizeInput(payload.stdMasuk, 10);
    var stdPulang = sanitizeInput(payload.stdPulang, 10);

    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;

    if (editId) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === editId) {
          foundIndex = i + 1;
          break;
        }
      }
    }

    if (foundIndex !== -1) {
      sheet.getRange(foundIndex, 1, 1, 4).setValues([[editId, nama, stdMasuk, stdPulang]]);
      logAction(session.username, 'UPDATE_SHIFT', 'Update Shift: ' + nama);
    } else {
      var newId = 'SFT-' + (sheet.getLastRow() + 1);
      sheet.appendRow([newId, nama, stdMasuk, stdPulang]);
      logAction(session.username, 'CREATE_SHIFT', 'Tambah Shift: ' + nama);
    }

    return { success: true, message: 'Shift berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function deleteShift(token, id) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_SHIFT);
    if (!sheet) return { success: false, message: 'Shift tidak ditemukan' };

    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        sheet.deleteRow(i + 1);
        logAction(session.username, 'DELETE_SHIFT', 'Hapus Shift ID: ' + id);
        return { success: true, message: 'Shift terhapus' };
      }
    }
    return { success: false, message: 'Shift tidak ditemukan' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Batch deletes shift records (Admin only)
 */
function batchDeleteShift(token, ids) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };
  if (session.role !== 'Admin') return { success: false, message: 'Hanya Admin yang dapat menghapus.' };
  if (!Array.isArray(ids) || ids.length === 0) return { success: false, message: 'Pilih minimal satu data untuk dihapus.' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, message: 'Sistem sibuk.' };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_SHIFT);
    if (!sheet) return { success: false, message: 'Data shift tidak ditemukan' };

    var idMap = {};
    ids.forEach(function (id) { idMap[String(id).trim()] = true; });

    var data = sheet.getDataRange().getValues();
    var deletedCount = 0;

    for (var i = data.length - 1; i >= 1; i--) {
      if (idMap[String(data[i][0]).trim()]) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }

    return { success: true, message: deletedCount + ' data shift berhasil dihapus' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates late tolerance in minutes
 */
function saveToleransi(token, minutes) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_SETTINGS); }

    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'ToleransiMenit') {
        sheet.getRange(i + 1, 2).setValue(minutes);
        logAction(session.username, 'UPDATE_TOLERANSI', 'Set toleransi: ' + minutes + ' menit');
        return { success: true, message: 'Toleransi disimpan' };
      }
    }

    sheet.appendRow(['ToleransiMenit', minutes]);
    return { success: true, message: 'Toleransi disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Updates system timezone setting
 */
function saveZonaWaktu(token, timezoneStr) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_SETTINGS); }

    var cleanTz = sanitizeInput(timezoneStr, 50) || 'Asia/Jakarta';

    try {
      ss.setSpreadsheetTimeZone(cleanTz);
    } catch (errTz) { }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'ZonaWaktu') {
        sheet.getRange(i + 1, 2).setValue(cleanTz);
        logAction(session.username, 'UPDATE_TIMEZONE', 'Set zona waktu: ' + cleanTz);
        return { success: true, message: 'Zona waktu berhasil disimpan' };
      }
    }

    sheet.appendRow(['ZonaWaktu', cleanTz]);
    logAction(session.username, 'UPDATE_TIMEZONE', 'Set zona waktu: ' + cleanTz);
    return { success: true, message: 'Zona waktu berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Saves master data Jabatan list
 */
function saveMasterJabatan(token, list) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    var setSheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!setSheet) { setupDatabase(); setSheet = ss.getSheetByName(SHEET_SETTINGS); }

    var valStr = Array.isArray(list) ? list.join(',') : String(list || '');
    var data = setSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'MasterJabatan') {
        setSheet.getRange(i + 1, 2).setValue(valStr);
        logAction(session.username, 'UPDATE_JABATAN', 'Set master jabatan: ' + valStr);
        return { success: true, message: 'Master Jabatan berhasil disimpan' };
      }
    }

    setSheet.appendRow(['MasterJabatan', valStr]);
    logAction(session.username, 'UPDATE_JABATAN', 'Set master jabatan: ' + valStr);
    return { success: true, message: 'Master Jabatan berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Saves master data Departemen list
 */
function saveMasterDept(token, list) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  try {
    var ss = getSS();
    var setSheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!setSheet) { setupDatabase(); setSheet = ss.getSheetByName(SHEET_SETTINGS); }

    var valStr = Array.isArray(list) ? list.join(',') : String(list || '');
    var data = setSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'MasterDept') {
        setSheet.getRange(i + 1, 2).setValue(valStr);
        logAction(session.username, 'UPDATE_DEPT', 'Set master departemen: ' + valStr);
        return { success: true, message: 'Master Departemen berhasil disimpan' };
      }
    }

    setSheet.appendRow(['MasterDept', valStr]);
    logAction(session.username, 'UPDATE_DEPT', 'Set master departemen: ' + valStr);
    return { success: true, message: 'Master Departemen berhasil disimpan' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Batch imports attendance records from Fingerprint Machine Excel/CSV export
 */
function batchImportAbsen(token, records) {
  var session = validateSession(token);
  if (!session.valid) return { success: false, message: session.message, sessionExpired: true };

  if (!Array.isArray(records) || records.length === 0) {
    return { success: false, message: 'Tidak ada data presensi yang valid untuk diimport.' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: 'Sistem sibuk. Silakan coba lagi.' };

  try {
    var ss = getSS();
    var absenSheet = ss.getSheetByName(SHEET_ABSEN);
    if (!absenSheet) { setupDatabase(); absenSheet = ss.getSheetByName(SHEET_ABSEN); }

    var karSheet = ss.getSheetByName(SHEET_KARYAWAN);
    if (!karSheet) { setupDatabase(); karSheet = ss.getSheetByName(SHEET_KARYAWAN); }

    var shiftSheet = ss.getSheetByName(SHEET_SHIFT);
    var shifts = [];
    if (shiftSheet && shiftSheet.getLastRow() > 1) {
      var rawShifts = shiftSheet.getRange(2, 1, shiftSheet.getLastRow() - 1, 4).getDisplayValues();
      rawShifts.forEach(function (s) {
        if (s[0]) shifts.push({ id: s[0], nama: s[1], stdMasuk: s[2], stdPulang: s[3] });
      });
    }

    var existingKarData = karSheet.getLastRow() > 1 ? karSheet.getRange(2, 1, karSheet.getLastRow() - 1, 4).getValues() : [];
    var karMap = {};
    existingKarData.forEach(function (k) {
      if (k[0]) karMap[String(k[0]).trim().toUpperCase()] = { id: String(k[0]), nama: String(k[1]), jabatan: String(k[2]), dept: String(k[3]) };
    });

    var existingAbsenData = absenSheet.getLastRow() > 1 ? absenSheet.getRange(2, 1, absenSheet.getLastRow() - 1, 14).getValues() : [];
    var absenKeyRowMap = {};
    for (var i = 0; i < existingAbsenData.length; i++) {
      var row = existingAbsenData[i];
      var key = String(row[1]).trim() + '_' + String(row[2]).trim().toUpperCase(); // Tanggal_IDKaryawan
      absenKeyRowMap[key] = i + 2;
    }

    var importedCount = 0;
    var updatedCount = 0;
    var newKarRows = [];

    records.forEach(function (rec) {
      var idKar = String(rec.idKaryawan || '').trim();
      var namaKar = String(rec.nama || '').trim();
      var dept = String(rec.dept || '').trim();
      var keterangan = String(rec.keterangan || '').trim();
      var tgl = String(rec.tanggal || '').trim();
      var stdMasukExcel = String(rec.stdMasuk || '').trim();
      var stdPulangExcel = String(rec.stdPulang || '').trim();
      var scanMasuk = String(rec.scanMasuk || '').trim();
      var scanPulang = String(rec.scanPulang || '').trim();

      if (!idKar || !tgl) return;

      var keyKar = idKar.toUpperCase();
      if (!karMap[keyKar]) {
        karMap[keyKar] = { id: idKar, nama: namaKar || idKar, jabatan: '-', dept: dept || 'Umum' };
        newKarRows.push([idKar, namaKar || idKar, '-', dept || 'Umum']);
      }

      var karObj = karMap[keyKar];

      // Helper to normalize time to "HH:mm" format (supports 12-hour AM/PM and 24-hour)
      function normalizeTimeStr(tStr) {
        if (!tStr) return '';
        var clean = String(tStr).trim();
        var isPM = /pm/i.test(clean);
        var isAM = /am/i.test(clean);
        var match = clean.match(/(\d{1,2}):(\d{2})/);
        if (match) {
          var h = parseInt(match[1], 10);
          var m = parseInt(match[2], 10);
          if (isPM && h < 12) h += 12;
          if (isAM && h === 12) h = 0;
          return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        }
        return clean;
      }

      var normStdM = normalizeTimeStr(stdMasukExcel);
      var normStdP = normalizeTimeStr(stdPulangExcel);

      // Smart Master Shift matching
      var matchedShift = null;

      // 1. Prioritize matching by standard entry & exit time from Excel
      if (normStdM && normStdM !== '00:00') {
        // 1a. Try exact match for both stdMasuk and stdPulang
        matchedShift = shifts.find(function (s) {
          return normalizeTimeStr(s.stdMasuk) === normStdM && normalizeTimeStr(s.stdPulang) === normStdP;
        });

        // 1b. If not found, try matching stdMasuk alone
        if (!matchedShift) {
          matchedShift = shifts.find(function (s) {
            return normalizeTimeStr(s.stdMasuk) === normStdM;
          });
        }

        // 1c. If still not matched, match by closest master shift entry time to normStdM
        if (!matchedShift && shifts.length > 0) {
          var targetParts = normStdM.split(':');
          if (targetParts.length >= 2) {
            var targetMin = parseInt(targetParts[0], 10) * 60 + parseInt(targetParts[1], 10);
            var minDiff = 9999;
            shifts.forEach(function (s) {
              if (s.stdMasuk) {
                var sParts = normalizeTimeStr(s.stdMasuk).split(':');
                if (sParts.length >= 2) {
                  var sMin = parseInt(sParts[0], 10) * 60 + parseInt(sParts[1], 10);
                  var diff = Math.abs(targetMin - sMin);
                  if (diff < minDiff && diff <= 120) { // within 2 hours
                    minDiff = diff;
                    matchedShift = s;
                  }
                }
              }
            });
          }
        }
      }

      // 2. Only if Excel standard time is missing or 00:00, fallback to matching by scanMasuk
      if (!matchedShift && (!normStdM || normStdM === '00:00') && scanMasuk && scanMasuk !== '-' && shifts.length > 0) {
        var scanParts = normalizeTimeStr(scanMasuk).split(':');
        if (scanParts.length >= 2) {
          var scanMin = parseInt(scanParts[0], 10) * 60 + parseInt(scanParts[1], 10);
          var minDiffScan = 9999;
          shifts.forEach(function (s) {
            if (s.stdMasuk) {
              var sParts = normalizeTimeStr(s.stdMasuk).split(':');
              if (sParts.length >= 2) {
                var stdMin = parseInt(sParts[0], 10) * 60 + parseInt(sParts[1], 10);
                var diff = Math.abs(scanMin - stdMin);
                if (diff < minDiffScan && diff <= 180) { // within 3 hours
                  minDiffScan = diff;
                  matchedShift = s;
                }
              }
            }
          });
        }
      }

      var shiftName = matchedShift ? matchedShift.nama : (normStdM && normStdM !== '00:00' ? 'Shift ' + normStdM + '-' + normStdP : (shifts.length > 0 ? shifts[0].nama : 'Shift Normal'));
      var stdM = matchedShift ? matchedShift.stdMasuk : (normStdM && normStdM !== '00:00' ? normStdM : (shifts.length > 0 ? shifts[0].stdMasuk : '08:00'));
      var stdP = matchedShift ? matchedShift.stdPulang : (normStdP && normStdP !== '23:59' ? normStdP : (shifts.length > 0 ? shifts[0].stdPulang : '17:00'));

      var status = 'Hadir';
      var totalJam = '-';
      var hasMasuk = scanMasuk && scanMasuk !== '-';
      var hasPulang = scanPulang && scanPulang !== '-';

      if (hasMasuk && hasPulang) {
        var mArr = scanMasuk.split(':');
        var pArr = scanPulang.split(':');
        if (mArr.length >= 2 && pArr.length >= 2) {
          var startMin = parseInt(mArr[0]) * 60 + parseInt(mArr[1]);
          var endMin = parseInt(pArr[0]) * 60 + parseInt(pArr[1]);
          if (endMin < startMin) endMin += 24 * 60;
          var diffMin = endMin - startMin;
          totalJam = Math.floor(diffMin / 60) + ' Jam ' + (diffMin % 60) + ' Menit';

          var stdMArr = stdM.split(':');
          if (stdMArr.length >= 2) {
            var stdStartMin = parseInt(stdMArr[0]) * 60 + parseInt(stdMArr[1]);
            if (startMin > (stdStartMin + 10)) status = 'Terlambat';
          }

          if (status === 'Hadir') {
            var stdPArr = stdP.split(':');
            if (stdPArr.length >= 2) {
              var stdEndMin = parseInt(stdPArr[0]) * 60 + parseInt(stdPArr[1]);
              if (endMin < stdEndMin) status = 'Cepat Pulang';
            }
          }
        }
      } else if (hasMasuk && !hasPulang) {
        status = 'Tanpa Scan Pulang';
      } else if (!hasMasuk && hasPulang) {
        status = 'Tanpa Scan Masuk';
      }

      var keyAbsen = tgl + '_' + idKar.toUpperCase();
      var rowData = [
        'ABS-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        tgl,
        idKar,
        karObj.nama,
        '-',
        karObj.dept,
        keterangan,
        shiftName,
        stdM,
        stdP,
        scanMasuk || '-',
        scanPulang || '-',
        totalJam,
        status
      ];

      if (absenKeyRowMap[keyAbsen]) {
        var rowNum = absenKeyRowMap[keyAbsen];
        var origId = existingAbsenData[rowNum - 2][0];
        absenSheet.getRange(rowNum, 1, 1, 14).setValues([[
          origId, tgl, idKar, karObj.nama, '-', karObj.dept, keterangan,
          shiftName, stdM, stdP, scanMasuk || '-', scanPulang || '-', totalJam, status
        ]]);
        updatedCount++;
      } else {
        absenSheet.appendRow(rowData);
        importedCount++;
      }
    });

    if (newKarRows.length > 0) {
      newKarRows.forEach(function (r) { karSheet.appendRow(r); });
    }

    return {
      success: true,
      message: 'Import data mesin selesai! ' + importedCount + ' data baru ditambahkan, ' + updatedCount + ' data diperbarui.'
    };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}