window.addEventListener("keydown",(e)=>{
  switch (e.keyCode) {
    case 38: //Up
      if (!requestStop) {
        e.preventDefault();
        e.stopPropagation();
      }
      keys_dpad &= ~(1 << 2);
      break;
    case 40: //Down
      if (!requestStop) {
        e.preventDefault();
        e.stopPropagation();
      }
      keys_dpad &= ~(1 << 3);
      break;
    case 37: //Left
      keys_dpad &= ~(1 << 1);
      break;
    case 39: //Right
      keys_dpad &= ~(1 << 0);
      break;
    case 65: //A
      keys_buttons &= ~(1 << 0);
      break;
    case 90: //B
      keys_buttons &= ~(1 << 1);
      break;
    case 13: //Start
      keys_buttons &= ~(1 << 3);
      break;
    case 16: //Select
      keys_buttons &= ~(1 << 2);
      break;
  }
})
window.addEventListener("keyup",(e)=>{
  switch (e.keyCode) {
    case 38: //Up
      keys_dpad |= 1 << 2;
      break;
    case 40: //Down
      keys_dpad |= 1 << 3;
      break;
    case 37: //Left
      keys_dpad |= 1 << 1;
      break;
    case 39: //Right
      keys_dpad |= 1 << 0;
      break;
    case 65: //A
      keys_buttons |= 1 << 0;
      break;
    case 90: //B
      keys_buttons |= 1 << 1;
      break;
    case 13: //Start
      keys_buttons |= 1 << 3;
      break;
    case 16: //Select
      keys_buttons |= 1 << 2;
      break;
  }
})
document.getElementById("fileInput").addEventListener("change", (e) => {
  load_image(e.target.files[0]);
});
document.getElementById("setteings").addEventListener("click", (e) => {
  showSetting();
});
document.getElementById("settingdiv").addEventListener("click", (e) => {
  hideSetting();
});
document.getElementById("gamepad_button_container").addEventListener("click", (e) => {
  e.stopPropagation();
  e.preventDefault();
},true);
document.getElementById("zoom_select").addEventListener("change", (e) => {
  let val = e.target.value-0;
  zoomGB(val);
  localStorage.setItem("zoom",val);
});
window.addEventListener(
  "resize",
  (e) => {
    if(document.getElementById("zoom_select").value-0 === 4)resizeCanvas();
  },
  true
);
function zoomGB(val){
  if(val < 4){
    document.getElementById("gameboy_container").style.display = "block"
    let canvas = document.getElementById("output");
    canvas.style.height = "";
    canvas.style.width = "";
    document.getElementById("screen_container").appendChild(canvas)
    document.getElementById("gameboy_container").style.transform = "scale("+val+")";
  }else{
    document.getElementById("gameboy_container").style.display = "none"
    let canvas = document.getElementById("output");
    document.getElementById("full_container").appendChild(canvas)
    resizeCanvas();
  }
}
function load_image(file) {
  if(!file)return
  var reader = new FileReader();
  reader.onload = function () {
    start(reader.result, file.name);
  };
  reader.readAsArrayBuffer(file);
}

function hideSetting() {
  let elem = document.getElementById("settingdiv");
  if (elem.style.display == "block") {
    elem.style.left = "-500px";
    setTimeout(function () {
      elem.style.display = "none";
    }, 400);
  }
}
function showSetting() {
  document.getElementById("settingdiv").style.display = "block";
  setTimeout(function () {
    document.getElementById("settingdiv").style.left = 0;
  }, 10);
}
const resizeCanvas = () => {
  setTimeout(() => {
    let canvas = document.getElementById("output");
    const wh = window.innerHeight;
    const ww = window.innerWidth;
    const nw = 256;
    const nh = 224;
    const waspct = ww / wh;
    const naspct = nw / nh;
    if (waspct > naspct) {
      var val = wh / nh;
    } else {
      var val = ww / nw;
    }
    let ctrldiv = document.querySelector(".ctrl_div");
    canvas.style.height = 224 * val - ctrldiv.offsetHeight - 18 + "px";
    canvas.style.width = 256 * val - 24 + "px";
  }, 300);
};
let zoomval = localStorage.getItem("zoom");
if(zoomval){
  document.getElementById("zoom_select").value = zoomval;
  zoomGB(zoomval)
}