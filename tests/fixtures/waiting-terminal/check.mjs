console.log('WAIT_CHECK_STARTED');
let tick = 0;
const timer = setInterval(() => {
  console.log(`WAIT_CHECK_TICK_${++tick}`);
  if (tick === 14) {
    clearInterval(timer);
    console.log('WAIT_CHECK_PASSED');
  }
}, 1000);
