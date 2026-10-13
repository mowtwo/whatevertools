exports.greet = (who) => 'hello ' + who
// 循环依赖：cycle 在 helper 还没执行完时 require 它，拿到的是部分 exports
const cycle = require('./cycle')
exports.circular = () => cycle.sawGreet + '/' + cycle.sawCircular
