//资源下载记录 传资源id
function recordNum(souId) {
    $.ajax({
        url:interfaceurl + '/resources/'+souId+'/download_record',
        type:'PUT',
        async:true,
        headers:{
            'Content-Type':'application/json',
            'Authorization':$.cookie("Authorization")
        },
        success:function(data2,textStatus2,jqXHR2){

        },
        error:function(xhr2,textStatus2){

        }
    });
}
$(function () {
//点击下载资源
    $('.downloadThisSource').click(function () {
        if(!sUserInfo){
            layer.confirm('请先登录后下载!', {
                title:"温馨提示",
                skin:'layui-layer-molv tipsgologin',
                btn: ['去登录','取消'],
                closeBtn:0
            }, function(index){
                $('.loginGo').click();
                layer.close(index);
            }, function(index){
                layer.close(index);
            });
        }else{
            var downUrl=$(this).find('input').val();
            var rgx = /http/;
            if(!rgx.test(downUrl)){
                showError('暂无资源');
                return;
            }
            var souName=$(this).find('input').attr('name');
            var souId=$(this).find('input').attr('source-id');
            recordNum(souId);
            //console.log(souName)
            var rgxImg=/.jpg|.png|.bmp/;
            console.log(rgxImg)
            if(rgxImg.test(souName)){
                var isSupportDownload = 'download' in document.createElement('a');
                console.log(isSupportDownload)

                if(!isSupportDownload||navigator.userAgent.indexOf('Firefox') >= 0) {
                    layer.alert(
                        "该浏览器不支持直接下载，点击打开后请右键另存为...", {
                            btn:['确定'],
                            skin:"layui-layer-molv tipsgologin",
                            icon: 7,
                            title: "下载提示",
                            closeBtn: 1,
                            yes:function (index) {
                                layer.close(index);
                                window.open(downUrl,'_blank');
                            }
                        }
                    );
                }else{
                    $(this).attr('download',souName);
                    $(this).attr('href',downUrl);
                };
            }else{
                $(this).attr('download',souName);
                $(this).attr('href',downUrl);
            };
        }
    })
})