var $ = require("./lib/qsa");
var { mat4, vec3, vec4 } = require("gl-matrix");

// GL helper modules
var configProgram = require("./gl-program");
var loadTexture = require("./gl-texture");
var ElementMesh = require("./element");
var Camera = require("./camera");
var HeightMap = require("./heightmap");

// rendering state
const WIREFRAME = 0;
var downscaling = .3;
const DOWNSCALE_WINDOW = 100;

// some control constants
const HEIGHTMAP_SCALE = 1.0;
const HEIGHTMAP_DENSITY = 255;
const HEIGHTMAP_SIZE = 24;

// map coordinates
const MAP_BOUNDS = [[48.52163, -118.6259], [48.8532, -118.1260]];
const MAP_EXTENT = [
  Math.abs(MAP_BOUNDS[0][0] - MAP_BOUNDS[1][0]), 
  Math.abs(MAP_BOUNDS[0][1] - MAP_BOUNDS[1][1])
];
const MAP_CENTER = [
  MAP_BOUNDS[0][0] + MAP_EXTENT[0] * .5,
  MAP_BOUNDS[0][1] + MAP_EXTENT[1] * .5
];

var latlngToWorld = function(lat, lng) {
  var y = (lat - MAP_BOUNDS[0][0]) / MAP_EXTENT[0];
  y = (y - .5) * -2;
  var x = (lng - MAP_BOUNDS[0][1]) / MAP_EXTENT[1];
  x = (x - .5) * 2;
  return [x, y];
};

var locations = {
  unloading: [48.6826, -118.2377],
  den: [48.7191, -118.3341],
  salt: [48.7176, -118.3403]
};

// canvas setup
var canvas = document.querySelector("canvas");
canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;
var gl = canvas.getContext("webgl");
window.gl = gl;

// GL setup
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

// load shader programs
var polyProgram = configProgram(gl, {
  vertex: require("./vertex.glsl"),
  fragment: require("./fragment.glsl"),
  attributes: [
    "a_color",
    "a_normal",
    "a_position"
  ],
  uniforms: [
    "u_perspective",
    "u_camera",
    "u_position",
    "u_light_direction",
    "u_light_color",
    "u_light_intensity",
    "u_time",
    "u_false_color",
    "u_wireframe"
  ]
});

gl.useProgram(polyProgram);
polyProgram.setUniforms({
  u_light_direction: [.3, .3, .7],
  u_light_color: [0.5, 0.5, 0.5],
  u_light_intensity: .7
});

var pointProgram = configProgram(gl, {
  vertex: require("./vertex.glsl"),
  fragment: require("./pointFrag.glsl"),
  attributes: ["a_position"],
  uniforms: [
    "u_perspective",
    "u_camera",
    "u_position",
    "u_time",
    "u_resolution"
  ]
});

var camera = new Camera(canvas);

window.addEventListener("resize", function() {
  canvas.width = canvas.clientWidth * downscaling;
  canvas.height = canvas.clientHeight * downscaling;
  camera.configureFOV();
});

// load the landscape model and data
var landscape = new ElementMesh(gl);

var bitmap = new Image();
bitmap.src = "./assets/cropped.jpg";
var map = null;
var kills = [];

bitmap.onload = function(e) {
  map = new HeightMap(e.target, HEIGHTMAP_DENSITY, HEIGHTMAP_SIZE, HEIGHTMAP_SCALE);
  
  gl.bindBuffer(gl.ARRAY_BUFFER, landscape.attributes.a_position.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(map.verts), gl.STATIC_DRAW);
  landscape.attributes.a_position.length = map.verts.length;
  
  gl.bindBuffer(gl.ARRAY_BUFFER, landscape.attributes.a_color.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(map.color), gl.STATIC_DRAW);
  landscape.attributes.a_color.length = map.color.length;
  
  gl.bindBuffer(gl.ARRAY_BUFFER, landscape.attributes.a_normal.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(map.normals), gl.STATIC_DRAW);
  landscape.attributes.a_normal.length = map.normals.length;
  
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, landscape.index.buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(map.index), gl.STATIC_DRAW);
  landscape.index.length = map.index.length;

  window.depredationData.forEach(function(p) {
    var [dx, dz] = latlngToWorld(p.lat, p.lng);
    var dy = map.getPixel((dx + 1) / 2, (dz + 1) / 2)[0] / 255;
    dy += .3;
    kills.push(dx * HEIGHTMAP_SIZE / 2, dy, dz * HEIGHTMAP_SIZE / 2);
  });
  
  onScroll();
  requestAnimationFrame(render);
};

var textures = {
  grumpy: loadTexture(gl, "./assets/grump.jpg")
};

var meshes = [landscape];
camera.target = [landscape.position.x, landscape.position.y + 16, landscape.position.z];
camera.position = [landscape.position.x - 10, 10, landscape.position.z - 10];

var frameTimes = [];

// actual rendering code
var render = function(time) {

  gl.useProgram(polyProgram);
  
  // clear the canvas, but also the depth buffer
  canvas.width = canvas.clientWidth * downscaling;
  canvas.height = canvas.clientHeight * downscaling;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
  
  camera.update();
  
  // aim the camera at its target and generate a matrix to "move" the scene in front of the camera
  mat4.lookAt(camera.gaze, camera.position, camera.target, camera.up);

  polyProgram.setUniforms({
    u_time: time * 0.001,
    u_resolution: [canvas.width, canvas.height, 300],
    u_perspective: camera.perspective,
    u_camera: camera.gaze,
    u_false_color: 0
  });
  
  // now render the landscape
  meshes.forEach(mesh => drawModel(mesh));

  // and render point layers
  gl.useProgram(pointProgram);
  pointProgram.setUniforms({
    u_resolution: [canvas.width, canvas.height, 300],
    u_time: time * 0.001,
    u_perspective: camera.perspective,
    u_camera: camera.gaze,
    u_position: camera.identity
  });
  
  textures.grumpy.activate(pointProgram);
  drawPoints(kills);
  
  //schedule next update
  requestAnimationFrame(render);

  //based on recent frames, should we downscale the buffer?
  var elapsed = performance.now() - time;
  frameTimes.push(elapsed);
  frameTimes = frameTimes.slice(-DOWNSCALE_WINDOW).sort();
  if (frameTimes.length >= DOWNSCALE_WINDOW) {
    var average = frameTimes.reduce((t, n) => t + n, 0) / frameTimes.length;
    var max = Math.max.apply(null, frameTimes);
    var median = frameTimes[DOWNSCALE_WINDOW >> 1];
    // console.log(average, median, max);
    if (average > 10 || max > 100 || median > 40) {
      downscaling = downscaling == 1 ? .6 : .3;
    } else {
      downscaling = downscaling == .3 ? .6 : 1;
    }
    // console.log(`Reset downscaling to ${downscaling}`);
    frameTimes = [];
  }

};

var drawModel = function(mesh) {

  for (var k in mesh.attributes) {
    var b = mesh.attributes[k];
    var a = polyProgram.attributes[k];
    gl.enableVertexAttribArray(a);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buffer);
    gl.vertexAttribPointer(a, b.size, gl.FLOAT, false, 0, 0);
  }
  
  // generate a matrix to will move model vertexes around world space
  // this lets us generate model vertex values once, but easily reposition them
  var translation = vec4.fromValues(mesh.position.x, mesh.position.y, mesh.position.z, 1);
  var toWorld = mat4.create();
  mat4.fromTranslation(toWorld, translation);
  mat4.rotateY(toWorld, toWorld, mesh.position.r, [0, 0, 0]);
  
  // send the index buffer to the GPU to render it
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index.buffer);

  polyProgram.setUniforms({
    u_position: toWorld,
    u_wireframe: 0
  });

  gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_SHORT, 0);

  // overdraw
  if (WIREFRAME) {
    gl.uniform1f(polyProgram.uniforms.u_wireframe, 1);
    gl.drawElements(gl.LINES, mesh.index.length, gl.UNSIGNED_SHORT, 0);
  }

};

var drawPoints = function(points) {
  var pointBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
  gl.vertexAttribPointer(pointProgram.attributes.a_position, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(pointProgram.attributes.a_position);
  gl.drawArrays(gl.POINTS, 0, points.length / 3);
};

var stage = 0;
var repo = {
  1: {
    position: [landscape.position.x - 16, 7, landscape.position.z],
    target: [landscape.position.x, landscape.position.y, landscape.position.z]
  },
  2: {
    position: [landscape.position.x - 4, 3, landscape.position.z - 16],
    target: [landscape.position.x + 6, landscape.position.y, landscape.position.z]
  },
  3: {
    target: [landscape.position.x - 4, landscape.position.y, landscape.position.z - 3]
  }
};

var onScroll = function() {
  for (var i = 0; i < stageElements.length; i++) {
    var bounds = stageElements[i].getBoundingClientRect();
    if (bounds.top > 0 && bounds.top < window.innerHeight && bounds.bottom > 0) {
      var choice = stageElements[i].getAttribute("data-stage");
      if (stage == choice) return;
      var placement = repo[choice];
      if (!placement) return;
      performance.mark("reposition");
      camera.reposition(3000, placement.position, placement.target);
      stage = choice;
      return;
    }
  }
};

var stageElements = $(".stage");
window.addEventListener("scroll", onScroll);