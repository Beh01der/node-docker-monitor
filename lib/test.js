var monitor = require('./index');

monitor({
    onContainerUp: function(container) {
        console.log('Container up: ', container)
    },

    onContainerDown: function(container) {
        console.log('Container down: ', container)
    }
});