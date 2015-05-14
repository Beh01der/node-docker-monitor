/**

 docker listContainers result example:

 [{
   "Command": "/bin/sh -c '/bin/bash -c 'cd /home; mkdir data; node main/app.js''",
   "Created": 1431402173,
   "Id": "81cde361ec7b069cc1ee32a4660176306a2b1d3a3eb52f96f17380f10e75d2e2",
   "Image": "m4all-next:15-0511-1104",
   "Names": ["/m4all-next"],
   "Ports": [
     {
       "IP": "172.17.42.1",
       "PrivatePort": 3000,
       "PublicPort": 3002,
       "Type": "tcp"
     }
   ],
   "Status": "Up About an hour"
 }, ... ]


 docker events example:

 {"status":"die","id":"81cde361ec7b069cc1ee32a4660176306a2b1d3a3eb52f96f17380f10e75d2e2","from":"m4all-next:15-0511-1104","time":1431403163}
 {"status":"start","id":"81cde361ec7b069cc1ee32a4660176306a2b1d3a3eb52f96f17380f10e75d2e2","from":"m4all-next:15-0511-1104","time":1431403163}
 ...

 */

var Map = require('collections/fast-map');
require("collections/shim-object");

module.exports = function (handler, docker) {
    if (!docker) {
        var Docker = require('dockerode');
        docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }

    var trackedEvents = ['create', 'restart', 'start', 'destroy', 'die', 'kill', 'stop'];
    var positiveEvents = ['create', 'restart', 'start'];
    var containerByName = new Map();
    var containerById = new Map();

    function getContainerName(names) {
        for (i = 0; i < names.length; i++) {
            var nameElements = names[i].split('/');
            if (nameElements.length === 2) {
                return nameElements[1];
            }
        }
    }

    function updateContainer(info) {
        var oldInfo = containerByName.get(info.Name);

        var changed;
        if (oldInfo) {
            // existing service
            if (oldInfo.Id !== info.Id) {
                // existing service, new container
                changed = true;
                containerById.delete(oldInfo.Id);
                containerByName.delete(oldInfo.Name);
                handler.onContainerDown(oldInfo, docker);
            }
        } else {
            // new service
            changed = true;
        }

        if (changed) {
            containerByName.set(info.Name, info);
            containerById.set(info.Id, info);
            handler.onContainerUp(info, docker);
        }
    }

    function removeContainer(info) {
        var oldInfo = containerByName.get(info.Name);
        if (oldInfo) {
            containerById.delete(oldInfo.Id);
            containerByName.delete(oldInfo.Name);
            handler.onContainerDown(oldInfo, docker);
        }
    }

// initially populate container map
    function updateContainers(next) {
        docker.listContainers(function (err, list) {
            if (err) {
                console.log('Error listing running containers: %s', err.message, err);
                return next(err);
            }

            list.forEach(function (it) {
                var info = Object.clone(it);
                info.Name = getContainerName(it.Names);

                updateContainer(info)
            });

            next();
        });
    }

// start monitoring docker events
    function processDockerEvent(event, stop) {
        if (trackedEvents.indexOf(event.status) !== -1) {
            var container = containerById.get(event.id);
            if (container) {
                if (positiveEvents.indexOf(event.status) !== -1) {
                    updateContainer(container);
                } else {
                    removeContainer(container);
                }
            } else {
                // new container
                if (!stop && positiveEvents.indexOf(event.status) !== -1) {
                    updateContainers(function (err) {
                        if (!err) {
                            processDockerEvent(event, true);
                        }
                    });
                }
            }
        }
    }

    updateContainers(function (err) {
        if (!err) {
            docker.getEvents(function (err, data) {
                if (err) {
                    return console.log('Error getting docker events: %s', err.message, err);
                }

                // events: create, destroy, die, exec_create, exec_start, export, kill, oom, pause, restart, start, stop, unpause
                // positive: create, restart, start
                // negative: destroy, die, kill, stop
                data.on('data', function (chunk) {
                    var lines = chunk.toString().split('\n');
                    lines.forEach(function (line) {
                        try {
                            processDockerEvent(JSON.parse(line));
                        } catch (e){
                            console.log('Error reading Docker event: %s', e.message);
                        }
                    });
                });
            });
        }
    });
};
