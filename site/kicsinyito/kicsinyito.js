/* Aluljáró kicsinyítő. Minden a böngészőben történik. */
(function () {
  "use strict";

  var TARGET = Math.floor(2.9 * 1024 * 1024);
  var RETINA_H = 2800;
  var FLOOR_H = 1400;
  var MAX_W = 12000;
  var NAME_RE = /^(BAL|JOBB)_\d+\.jpe?g$/i;

  var drop = document.getElementById("drop");
  var picker = document.getElementById("picker");
  var pick = document.getElementById("pick");
  var results = document.getElementById("results");
  var zipButton = document.getElementById("zip");
  var batch = document.getElementById("batch");

  var ready = [];
  var queue = Promise.resolve();
  var busy = 0;

  pick.addEventListener("click", function () { picker.click(); });
  picker.addEventListener("change", function () {
    if (picker.files && picker.files.length) enqueue(picker.files);
    picker.value = "";
  });

  ["dragenter", "dragover"].forEach(function (type) {
    drop.addEventListener(type, function (event) {
      event.preventDefault();
      drop.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    drop.addEventListener(type, function (event) {
      event.preventDefault();
      drop.classList.remove("is-over");
    });
  });
  drop.addEventListener("drop", function (event) {
    if (event.dataTransfer && event.dataTransfer.files.length) {
      enqueue(event.dataTransfer.files);
    }
  });

  zipButton.addEventListener("click", function () {
    if (!ready.length) return;
    var blob = zipStore(ready.map(function (item) {
      return { name: item.name, data: item.data };
    }));
    saveBlob(blob, "panoramak.zip");
  });

  function enqueue(fileList) {
    var files = Array.prototype.slice.call(fileList);
    queue = queue.then(function () { return run(files); });
    return queue;
  }

  function run(files) {
    busy += files.length;
    updateBatch();
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return one(file); });
    });
    return chain;
  }

  function one(file) {
    var card = addCard(file);
    if (!isJpeg(file)) {
      finishCard(card, null, "Csak JPEG megy ide. Ezt a fájlt kihagytam.");
      busy -= 1;
      updateBatch();
      return Promise.resolve();
    }
    return shrink(file).then(function (result) {
      finishCard(card, result, "");
    }).catch(function () {
      finishCard(card, null, "Ezt a képet a böngésző nem tudta lekicsinyíteni.");
    }).then(function () {
      busy -= 1;
      updateBatch();
    });
  }

  function addCard(file) {
    var item = document.createElement("li");
    item.innerHTML =
      '<div class="row"><p class="name"></p></div>' +
      '<p class="meta">Készül…</p>';
    item.querySelector(".name").textContent = file.name;
    results.appendChild(item);
    return item;
  }

  function finishCard(card, result, error) {
    var meta = card.querySelector(".meta");
    if (!result) {
      meta.textContent = error;
      return;
    }
    var nameOk = NAME_RE.test(result.name);
    card.dataset.bytes = String(result.blob.size);
    card.dataset.width = String(result.width);
    card.dataset.height = String(result.height);
    card.dataset.name = result.name;
    card.dataset.warn = nameOk ? "" : "1";
    meta.textContent = formatBytes(result.before) + " → " + formatBytes(result.blob.size) +
      " · " + result.width + "×" + result.height +
      (result.untouched ? " · már belefért" : "");
    if (!nameOk) {
      var warn = document.createElement("p");
      warn.className = "warn";
      warn.textContent = "A név nem BAL_1.jpg vagy JOBB_2.jpg alakú. A honlap csak az ilyen nevű képeket veszi észre.";
      card.appendChild(warn);
    }
    var link = document.createElement("a");
    link.className = "download";
    link.href = URL.createObjectURL(result.blob);
    link.download = result.name;
    link.textContent = "Letöltés";
    card.querySelector(".row").appendChild(link);
    result.blob.arrayBuffer().then(function (buffer) {
      ready.push({ name: uniqueName(result.name), data: new Uint8Array(buffer) });
      zipButton.hidden = ready.length < 1;
    });
  }

  function uniqueName(name) {
    var used = ready.some(function (item) { return item.name === name; });
    if (!used) return name;
    var dot = name.lastIndexOf(".");
    var stem = dot === -1 ? name : name.slice(0, dot);
    var ext = dot === -1 ? "" : name.slice(dot);
    var n = 2;
    while (ready.some(function (item) { return item.name === stem + "-" + n + ext; })) n += 1;
    return stem + "-" + n + ext;
  }

  function updateBatch() {
    batch.hidden = busy === 0;
    batch.textContent = busy ? "Még " + busy + " kép készül…" : "";
  }

  function isJpeg(file) {
    return /\.jpe?g$/i.test(file.name) || file.type === "image/jpeg";
  }

  function shrink(file) {
    if (file.size <= TARGET) {
      return readSize(file).then(function (size) {
        return {
          name: file.name,
          blob: file,
          before: file.size,
          width: size.width,
          height: size.height,
          untouched: true
        };
      });
    }
    return file.arrayBuffer().then(function (buffer) {
      var size = jpegSize(buffer);
      var steps = sizeSteps(size.width, size.height);
      var attempt = Promise.resolve(null);
      steps.forEach(function (step) {
        attempt = attempt.then(function (found) {
          if (found) return found;
          return encodeFit(file, step.tw, step.th);
        });
      });
      return attempt.then(function (found) {
        if (!found) throw new Error("too big");
        return {
          name: file.name,
          blob: found.blob,
          before: file.size,
          width: found.width,
          height: found.height,
          untouched: false
        };
      });
    });
  }

  function sizeSteps(width, height) {
    var heights = [RETINA_H, 2200, 1800, FLOOR_H, 1100, 800];
    var widths = [MAX_W, 8000, 5000, 3200];
    var steps = [];
    var seen = {};
    heights.forEach(function (maxH) {
      widths.forEach(function (maxW) {
        var fitted = fit(width, height, Math.min(maxH, height), maxW);
        var key = fitted.tw + "x" + fitted.th;
        if (!seen[key]) {
          seen[key] = true;
          steps.push(fitted);
        }
      });
    });
    return steps;
  }

  function fit(width, height, maxH, maxW) {
    var scale = 1;
    if (height > maxH) scale = Math.min(scale, maxH / height);
    if (width * scale > maxW) scale = Math.min(scale, maxW / width);
    return {
      tw: Math.max(1, Math.round(width * scale)),
      th: Math.max(1, Math.round(height * scale))
    };
  }

  function encodeFit(file, tw, th) {
    return decodeScaled(file, tw, th).then(function (bitmap) {
      return searchQuality(bitmap).then(function (blob) {
        var width = bitmap.width;
        var height = bitmap.height;
        bitmap.close();
        if (!blob || blob.size > TARGET) return null;
        return { blob: blob, width: width, height: height };
      }).catch(function (error) {
        bitmap.close();
        throw error;
      });
    });
  }

  function decodeScaled(file, tw, th) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, {
        resizeWidth: tw,
        resizeHeight: th,
        resizeQuality: "high"
      }).catch(function () {
        return createImageBitmap(file).then(function (full) {
          return drawScaled(full, tw, th);
        });
      });
    }
    return loadImage(file).then(function (image) {
      return drawScaled(image, tw, th).then(function (bitmap) {
        return bitmap;
      });
    });
  }

  function drawScaled(source, tw, th) {
    var canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    var context = canvas.getContext("2d", { alpha: false });
    context.drawImage(source, 0, 0, tw, th);
    if (source.close) source.close();
    return createImageBitmap(canvas).then(function (bitmap) {
      canvas.width = 0;
      canvas.height = 0;
      return bitmap;
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      image.src = url;
    });
  }

  function searchQuality(bitmap) {
    var qualities = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
    var chain = Promise.resolve(null);
    qualities.forEach(function (quality) {
      chain = chain.then(function (best) {
        if (best) return best;
        return encode(bitmap, quality).then(function (blob) {
          return blob.size <= TARGET ? blob : null;
        });
      });
    });
    return chain;
  }

  function encode(bitmap, quality) {
    var canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    var context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("encode"));
      }, "image/jpeg", quality);
    });
  }

  function readSize(file) {
    return file.arrayBuffer().then(function (buffer) {
      try { return jpegSize(buffer); }
      catch (error) { return { width: 0, height: 0 }; }
    });
  }

  function jpegSize(buffer) {
    var view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) throw new Error("not jpeg");
    var width = 0;
    var height = 0;
    var offset = 2;
    while (offset + 8 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      var marker = view.getUint8(offset + 1);
      if (marker === 0xD8 || marker === 0x01) { offset += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      var length = view.getUint16(offset + 2);
      if (marker >= 0xC0 && marker <= 0xC3) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += 2 + length;
    }
    if (!width || !height) throw new Error("no size");
    if (orientationSwaps(view)) return { width: height, height: width };
    return { width: width, height: height };
  }

  function orientationSwaps(view) {
    var offset = 2;
    while (offset + 10 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) return false;
      var marker = view.getUint8(offset + 1);
      if (marker === 0xDA || marker === 0xD9) return false;
      var length = view.getUint16(offset + 2);
      if (marker === 0xE1 && length > 16 && view.getUint32(offset + 4) === 0x45786966) {
        var value = tiffOrientation(view, offset + 10);
        return value >= 5 && value <= 8;
      }
      offset += 2 + length;
    }
    return false;
  }

  function tiffOrientation(view, start) {
    var little = view.getUint16(start) === 0x4949;
    var read16 = function (pos) { return view.getUint16(pos, little); };
    var read32 = function (pos) { return view.getUint32(pos, little); };
    if (read16(start + 2) !== 42) return 1;
    var ifd = start + read32(start + 4);
    if (ifd + 2 > view.byteLength) return 1;
    var count = read16(ifd);
    var i;
    for (i = 0; i < count; i++) {
      var entry = ifd + 2 + i * 12;
      if (entry + 12 > view.byteLength) return 1;
      if (read16(entry) === 0x0112) return read16(entry + 8);
    }
    return 1;
  }

  function formatBytes(bytes) {
    return (bytes / (1024 * 1024)).toLocaleString("hu-HU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }) + " MB";
  }

  function saveBlob(blob, name) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
  }

  function zipStore(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (file) {
      var nameBytes = new TextEncoder().encode(file.name);
      var crc = crc32(file.data);
      var local = new Uint8Array(30 + nameBytes.length);
      var view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(8, 0, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, file.data.length, true);
      view.setUint32(22, file.data.length, true);
      view.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      parts.push(local, file.data);
      var record = new Uint8Array(46 + nameBytes.length);
      var centralView = new DataView(record.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, file.data.length, true);
      centralView.setUint32(24, file.data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint32(42, offset, true);
      record.set(nameBytes, 46);
      central.push(record);
      offset += local.length + file.data.length;
    });
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: "application/zip" });
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    var n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    var c = 0xFFFFFFFF;
    var i;
    for (i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  window.__kicsinyito = { enqueue: enqueue, ready: function () { return ready; }, target: TARGET };
})();
